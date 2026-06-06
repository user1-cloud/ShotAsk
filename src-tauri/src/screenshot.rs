use anyhow::Result;
use std::sync::OnceLock;
use std::sync::mpsc;

/// Dedicated capture thread: caches the DXGI device across captures so we
/// don't pay Monitor::all() + device-creation cost on every screenshot.
fn capture_tx() -> &'static mpsc::SyncSender<mpsc::SyncSender<Result<Vec<u8>>>> {
    static CHAN: OnceLock<mpsc::SyncSender<mpsc::SyncSender<Result<Vec<u8>>>>> = OnceLock::new();
    CHAN.get_or_init(|| {
        let (tx, rx) = mpsc::sync_channel::<mpsc::SyncSender<Result<Vec<u8>>>>(1);
        std::thread::spawn(move || {
            let mut monitor: Option<xcap::Monitor> = None;
            while let Ok(reply_tx) = rx.recv() {
                let result = capture_inner(&mut monitor);
                let _ = reply_tx.send(result);
            }
        });
        tx
    })
}

fn capture_inner(monitor: &mut Option<xcap::Monitor>) -> Result<Vec<u8>> {
    // Try cached monitor first — avoids DXGI device re-creation
    if let Some(ref mon) = monitor {
        if let Ok(image) = mon.capture_image() {
            if let Ok(data) = fast_png_encode(&image) {
                return Ok(data);
            }
        }
        // Stale monitor (e.g. display config changed) — invalidate
        *monitor = None;
    }

    let monitors =
        xcap::Monitor::all().map_err(|e| anyhow::anyhow!("Monitor enum failed: {}", e))?;
    let mon = monitors
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("No monitors found"))?;
    let image = mon
        .capture_image()
        .map_err(|e| anyhow::anyhow!("Capture failed: {}", e))?;
    let data = fast_png_encode(&image)?;
    *monitor = Some(mon);
    Ok(data)
}

/// Encode RGBA pixels to PNG using the fastest compression level.
fn fast_png_encode(image: &image::RgbaImage) -> Result<Vec<u8>> {
    let (w, h) = image.dimensions();
    let mut buf = Vec::with_capacity((w as usize) * (h as usize));
    {
        let mut encoder = png::Encoder::new(&mut buf, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder
            .write_header()
            .map_err(|e| anyhow::anyhow!("PNG header: {}", e))?;
        writer
            .write_image_data(image.as_raw())
            .map_err(|e| anyhow::anyhow!("PNG data: {}", e))?;
    }
    Ok(buf)
}

/// Capture fullscreen via the persistent capture thread.
pub fn capture_fullscreen() -> Result<Vec<u8>> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    capture_tx()
        .send(reply_tx)
        .map_err(|_| anyhow::anyhow!("Capture thread died"))?;
    reply_rx
        .recv()
        .map_err(|_| anyhow::anyhow!("Capture thread died"))?
}

/// Get monitor dimensions (width, height, x, y) for all monitors
pub fn get_monitor_info() -> Result<Vec<MonitorInfo>> {
    let monitors = xcap::Monitor::all()?;
    let mut info = Vec::new();
    for m in &monitors {
        info.push(MonitorInfo {
            name: m.name().to_string(),
            width: m.width(),
            height: m.height(),
            x: m.x(),
            y: m.y(),
        });
    }
    Ok(info)
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

/// Resize image to fit within max_dim on the longest side, return PNG bytes
#[allow(dead_code)]
pub fn resize_to_fit(image_data: &[u8], max_dim: u32) -> Result<Vec<u8>> {
    let img = image::load_from_memory(image_data)?;
    let (w, h) = (img.width(), img.height());
    if w <= max_dim && h <= max_dim {
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png)?;
        return Ok(buf.into_inner());
    }
    let ratio = max_dim as f64 / w.max(h) as f64;
    let new_w = (w as f64 * ratio) as u32;
    let new_h = (h as f64 * ratio) as u32;
    let resized = img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);
    let mut buf = std::io::Cursor::new(Vec::new());
    resized.write_to(&mut buf, image::ImageFormat::Png)?;
    Ok(buf.into_inner())
}

/// Crop a PNG image to the specified region
/// x, y, width, height are in logical pixels
pub fn crop_screenshot(
    image_data: &[u8],
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<Vec<u8>> {
    let img = image::load_from_memory(image_data)?;
    let cropped = img.crop_imm(x, y, width.max(1), height.max(1));
    let mut buf = std::io::Cursor::new(Vec::new());
    cropped.write_to(&mut buf, image::ImageFormat::Png)?;
    Ok(buf.into_inner())
}
