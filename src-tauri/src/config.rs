use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub shortcut: String,
    pub api_type: ApiType,
    pub ollama_endpoint: String,
    pub ollama_model: String,
    pub openai_endpoint: String,
    pub openai_key: String,
    pub openai_model: String,
    pub zhipu_key: String,
    pub zhipu_model: String,
    pub custom_endpoint: String,
    pub custom_key: String,
    pub custom_model: String,
    pub system_prompt: String,
    pub result_win_x: Option<i32>,
    pub result_win_y: Option<i32>,
    pub result_win_w: Option<u32>,
    pub result_win_h: Option<u32>,
    pub result_win_zoom: Option<f32>,
    pub main_win_x: Option<i32>,
    pub main_win_y: Option<i32>,
    pub main_win_w: Option<u32>,
    pub main_win_h: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ApiType {
    Ollama,
    OpenAI,
    ZhiPu,
    Custom,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut: "Alt+S".to_string(),
            api_type: ApiType::Ollama,
            ollama_endpoint: "http://localhost:11434".to_string(),
            ollama_model: "llava:latest".to_string(),
            openai_endpoint: "https://api.openai.com/v1".to_string(),
            openai_key: String::new(),
            openai_model: "gpt-4o".to_string(),
            zhipu_key: String::new(),
            zhipu_model: "glm-4v-flash".to_string(),
            custom_endpoint: String::new(),
            custom_key: String::new(),
            custom_model: String::new(),
            system_prompt: "You are a helpful assistant. Analyze this screenshot image and answer any questions about it. Be concise and direct. If there's text in the screenshot, read and explain it. If there's code, analyze it. If there's a UI, describe it. Respond in Chinese.".to_string(),
            result_win_x: None,
            result_win_y: None,
            result_win_w: None,
            result_win_h: None,
            result_win_zoom: None,
            main_win_x: None,
            main_win_y: None,
            main_win_w: None,
            main_win_h: None,
        }
    }
}

fn config_path() -> Result<PathBuf> {
    let proj_dirs = directories::ProjectDirs::from("com", "shotask", "ShotAsk")
        .ok_or_else(|| anyhow::anyhow!("Could not find project directory"))?;
    let dir = proj_dirs.config_dir();
    std::fs::create_dir_all(dir)?;
    Ok(dir.join("config.json"))
}

pub fn load_config() -> AppConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => {
            let config = AppConfig::default();
            let _ = save_config(&config);
            config
        }
    }
}

pub fn save_config(config: &AppConfig) -> Result<()> {
    let path = config_path()?;
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(path, json)?;
    Ok(())
}
