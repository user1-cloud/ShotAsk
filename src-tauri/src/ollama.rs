use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
    images: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIMessage {
    role: String,
    content: Vec<OpenAIContent>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIContent {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
    image_url: Option<OpenAIImageUrl>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIImageUrl {
    url: String,
    detail: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChunk {
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChoice {
    delta: OpenAIStreamDelta,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamDelta {
    content: Option<String>,
}

pub async fn ask_ollama(
    image_data: &[u8],
    prompt: &str,
    endpoint: &str,
    model: &str,
    app: &tauri::AppHandle,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String> {
    let image_b64 = BASE64.encode(image_data);
    let client = reqwest::Client::new();

    let request = OllamaRequest {
        model: model.to_string(),
        messages: vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
            images: Some(vec![image_b64]),
        }],
        stream: true,
    };

    #[derive(Deserialize)]
    struct StreamChunk {
        message: Option<StreamMessage>,
        done: bool,
    }

    #[derive(Deserialize)]
    struct StreamMessage {
        content: String,
    }

    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));
    log::info!("Ollama streaming request to {} model={}", url, model);
    let resp = client.post(&url).json(&request).send().await?;
    log::info!("Ollama response status: {}", resp.status());

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buf = String::new();
    let mut done = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow::anyhow!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Drain complete lines, keep partial line in buffer
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].to_string();
            buf = buf[nl + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            log::debug!("Ollama line: {}", &line[..line.len().min(200)]);
            if let Ok(parsed) = serde_json::from_str::<StreamChunk>(&line) {
                if let Some(msg) = parsed.message {
                    if !msg.content.is_empty() {
                        full_text.push_str(&msg.content);
                        let _ = app.emit("ai-stream-chunk", serde_json::json!({
                            "text": msg.content
                        }));
                    }
                }
                if parsed.done {
                    log::info!("Ollama stream done, total {} chars", full_text.len());
                    done = true;
                    break;
                }
            }
            if cancel_flag.load(Ordering::SeqCst) {
                log::info!("Ollama stream cancelled, got {} chars so far", full_text.len());
                if !full_text.is_empty() {
                    return Ok(full_text);
                }
                return Err(anyhow::anyhow!("Analysis cancelled"));
            }
        }
        if done {
            break;
        }
    }

    if full_text.is_empty() {
        Err(anyhow::anyhow!("Empty response from Ollama"))
    } else {
        Ok(full_text)
    }
}

pub async fn ask_openai(
    image_data: &[u8],
    prompt: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    app: &tauri::AppHandle,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String> {
    let image_b64 = BASE64.encode(image_data);
    let client = reqwest::Client::new();

    #[derive(Serialize)]
    struct StreamOpenAIRequest {
        model: String,
        messages: Vec<OpenAIMessage>,
        max_tokens: u32,
        stream: bool,
    }

    let request = StreamOpenAIRequest {
        model: model.to_string(),
        messages: vec![OpenAIMessage {
            role: "user".to_string(),
            content: vec![
                OpenAIContent {
                    content_type: "text".to_string(),
                    text: Some(prompt.to_string()),
                    image_url: None,
                },
                OpenAIContent {
                    content_type: "image_url".to_string(),
                    text: None,
                    image_url: Some(OpenAIImageUrl {
                        url: format!("data:image/png;base64,{}", image_b64),
                        detail: "auto".to_string(),
                    }),
                },
            ],
        }],
        max_tokens: 1024,
        stream: true,
    };

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    log::info!("OpenAI streaming request to {} model={}", url, model);
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request)
        .send()
        .await?;
    log::info!("OpenAI response status: {}", resp.status());

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow::anyhow!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].to_string();
            buf = buf[nl + 1..].to_string();

            let data = line.trim_start_matches("data: ").trim_start_matches("data:");
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                log::info!("OpenAI stream done, total {} chars", full_text.len());
                buf.clear();
                break;
            }

            if let Ok(parsed) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                if let Some(choice) = parsed.choices.first() {
                    if let Some(content) = &choice.delta.content {
                        if !content.is_empty() {
                            full_text.push_str(content);
                            let _ = app.emit("ai-stream-chunk", serde_json::json!({
                                "text": content
                            }));
                        }
                    }
                }
            }
        }

        if cancel_flag.load(Ordering::SeqCst) {
            log::info!("OpenAI stream cancelled, got {} chars so far", full_text.len());
            if !full_text.is_empty() {
                return Ok(full_text);
            }
            return Err(anyhow::anyhow!("Analysis cancelled"));
        }
    }

    if full_text.is_empty() {
        Err(anyhow::anyhow!("Empty response from OpenAI-compatible API"))
    } else {
        Ok(full_text)
    }
}

#[derive(Debug, Deserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// Multi-turn chat for Ollama (vision models)
pub async fn chat_ollama(
    image_b64: &str,
    system_prompt: &str,
    history: &[ChatMsg],
    new_message: &str,
    endpoint: &str,
    model: &str,
    app: &tauri::AppHandle,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String> {
    let client = reqwest::Client::new();
    let mut messages: Vec<OllamaMessage> = Vec::new();

    // Build conversation: alternate user/assistant with image in each user turn
    for msg in history {
        let images = if msg.role == "user" {
            Some(vec![image_b64.to_string()])
        } else {
            None
        };
        messages.push(OllamaMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
            images,
        });
    }
    // Add new user message
    messages.push(OllamaMessage {
        role: "user".to_string(),
        content: new_message.to_string(),
        images: Some(vec![image_b64.to_string()]),
    });

    // Ollama doesn't support system role natively; prepend to first user message
    if !system_prompt.is_empty() && messages.first().map_or(false, |m| m.role == "user") {
        messages[0].content = format!("[System: {}]\n\n{}", system_prompt, messages[0].content);
    }

    let request = OllamaRequest {
        model: model.to_string(),
        messages,
        stream: true,
    };

    #[derive(Deserialize)]
    struct StreamChunk {
        message: Option<StreamMessage>,
        done: bool,
    }
    #[derive(Deserialize)]
    struct StreamMessage {
        content: String,
    }

    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));
    log::info!("Ollama multi-turn chat request to {} model={}", url, model);
    let resp = client.post(&url).json(&request).send().await?;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow::anyhow!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].to_string();
            buf = buf[nl + 1..].to_string();
            if line.is_empty() { continue; }
            if let Ok(parsed) = serde_json::from_str::<StreamChunk>(&line) {
                if let Some(msg) = parsed.message {
                    if !msg.content.is_empty() {
                        full_text.push_str(&msg.content);
                        let _ = app.emit("ai-stream-chunk", serde_json::json!({ "text": msg.content }));
                    }
                }
                if parsed.done { break; }
            }
            if cancel_flag.load(Ordering::SeqCst) {
                if !full_text.is_empty() { return Ok(full_text); }
                return Err(anyhow::anyhow!("Analysis cancelled"));
            }
        }
    }

    if full_text.is_empty() {
        Err(anyhow::anyhow!("Empty response from Ollama"))
    } else {
        Ok(full_text)
    }
}

/// Multi-turn chat for OpenAI-compatible APIs (OpenAI, ZhiPu)
pub async fn chat_openai(
    image_b64: &str,
    system_prompt: &str,
    history: &[ChatMsg],
    new_message: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    app: &tauri::AppHandle,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String> {
    let client = reqwest::Client::new();
    let img_url = format!("data:image/png;base64,{}", image_b64);
    let mut messages: Vec<OpenAIMessage> = Vec::new();

    // Prepend system prompt to first user message (avoids extra API call for system role)
    let effective_prompt = if system_prompt.is_empty() {
        String::new()
    } else {
        format!("[System: {}]\n\n", system_prompt)
    };

    // Build conversation with image in each user turn
    for (i, msg) in history.iter().enumerate() {
        let text = if i == 0 && msg.role == "user" {
            format!("{}{}", effective_prompt, msg.content)
        } else {
            msg.content.clone()
        };
        let content = if msg.role == "user" {
            vec![
                OpenAIContent {
                    content_type: "text".to_string(),
                    text: Some(text),
                    image_url: None,
                },
                OpenAIContent {
                    content_type: "image_url".to_string(),
                    text: None,
                    image_url: Some(OpenAIImageUrl { url: img_url.clone(), detail: "auto".to_string() }),
                },
            ]
        } else {
            vec![OpenAIContent {
                content_type: "text".to_string(),
                text: Some(msg.content.clone()),
                image_url: None,
            }]
        };
        messages.push(OpenAIMessage { role: msg.role.clone(), content });
    }

    // Add new user message with image
    messages.push(OpenAIMessage {
        role: "user".to_string(),
        content: vec![
            OpenAIContent {
                content_type: "text".to_string(),
                text: Some(new_message.to_string()),
                image_url: None,
            },
            OpenAIContent {
                content_type: "image_url".to_string(),
                text: None,
                image_url: Some(OpenAIImageUrl { url: img_url, detail: "auto".to_string() }),
            },
        ],
    });

    #[derive(Serialize)]
    struct StreamOpenAIRequest {
        model: String,
        messages: Vec<OpenAIMessage>,
        max_tokens: u32,
        stream: bool,
    }

    let request = StreamOpenAIRequest {
        model: model.to_string(),
        messages,
        max_tokens: 1024,
        stream: true,
    };

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    log::info!("OpenAI multi-turn chat request to {} model={}", url, model);
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request)
        .send()
        .await?;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow::anyhow!("Stream error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].to_string();
            buf = buf[nl + 1..].to_string();
            let data = line.trim_start_matches("data: ").trim_start_matches("data:");
            if data.is_empty() { continue; }
            if data == "[DONE]" { break; }
            if let Ok(parsed) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                if let Some(choice) = parsed.choices.first() {
                    if let Some(content) = &choice.delta.content {
                        if !content.is_empty() {
                            full_text.push_str(content);
                            let _ = app.emit("ai-stream-chunk", serde_json::json!({ "text": content }));
                        }
                    }
                }
            }
        }

        if cancel_flag.load(Ordering::SeqCst) {
            if !full_text.is_empty() { return Ok(full_text); }
            return Err(anyhow::anyhow!("Analysis cancelled"));
        }
    }

    if full_text.is_empty() {
        Err(anyhow::anyhow!("Empty response from OpenAI-compatible API"))
    } else {
        Ok(full_text)
    }
}
