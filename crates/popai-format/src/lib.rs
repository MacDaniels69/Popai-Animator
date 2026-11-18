//! The `.popai` project file.
//!
//! ```text
//! offset  size  field
//!      0     8  magic  "POPAIPRJ"
//!      8     2  format version (little-endian u16) = 1
//!     10     2  flags (reserved, 0)
//!     12     4  thumbnail length T (u32 LE) — PNG of the camera view, may be 0
//!     16     4  project length P (u32 LE) — UTF-8 JSON, the same text as a .popai.json file
//!     20     T  thumbnail PNG
//!   20+T     P  project JSON
//! ```
//! The thumbnail sits before the project so File Explorer only reads the first few kilobytes.
//! Older `.popai.json` files (plain JSON) are still opened as they are.

pub const MAGIC: &[u8; 8] = b"POPAIPRJ";
pub const VERSION: u16 = 1;
pub const HEADER: usize = 20;
/// Thumbnails are small previews; anything larger is treated as damage.
pub const MAX_THUMBNAIL: usize = 8 * 1024 * 1024;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub version: u16,
    pub thumbnail_len: usize,
    pub project_len: usize,
}

/// True if the bytes start like a `.popai` container (as opposed to a plain JSON project).
pub fn is_container(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && &bytes[..8] == MAGIC
}

pub fn read_header(bytes: &[u8]) -> Result<Header, String> {
    if bytes.len() < HEADER || !is_container(bytes) {
        return Err("Not a Popai project file".into());
    }
    let u16_at = |o: usize| u16::from_le_bytes([bytes[o], bytes[o + 1]]);
    let u32_at = |o: usize| u32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]) as usize;
    let version = u16_at(8);
    if version == 0 || version > VERSION {
        return Err(format!("This project was saved by a newer Popai Animator (file format {version}). Update the app to open it."));
    }
    let h = Header { version, thumbnail_len: u32_at(12), project_len: u32_at(16) };
    if h.thumbnail_len > MAX_THUMBNAIL {
        return Err("The project file is damaged (thumbnail size)".into());
    }
    Ok(h)
}

/// Build a `.popai` file. `thumbnail` must be a PNG (or empty).
pub fn encode(project_json: &str, thumbnail: &[u8]) -> Result<Vec<u8>, String> {
    if !thumbnail.is_empty() && (thumbnail.len() < 8 || &thumbnail[..8] != PNG_SIGNATURE) {
        return Err("Thumbnail must be a PNG image".into());
    }
    if thumbnail.len() > MAX_THUMBNAIL || project_json.len() > u32::MAX as usize {
        return Err("Project is too large".into());
    }
    let mut out = Vec::with_capacity(HEADER + thumbnail.len() + project_json.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(thumbnail.len() as u32).to_le_bytes());
    out.extend_from_slice(&(project_json.len() as u32).to_le_bytes());
    out.extend_from_slice(thumbnail);
    out.extend_from_slice(project_json.as_bytes());
    Ok(out)
}

/// Project JSON from either a `.popai` container or a plain `.popai.json` file.
pub fn project_text(bytes: &[u8]) -> Result<String, String> {
    if !is_container(bytes) {
        let start = if bytes.starts_with(b"\xEF\xBB\xBF") { 3 } else { 0 }; // tolerate a UTF-8 BOM
        return String::from_utf8(bytes[start..].to_vec()).map_err(|_| "The project file is not valid text".to_string());
    }
    let h = read_header(bytes)?;
    let start = HEADER + h.thumbnail_len;
    let end = start.checked_add(h.project_len).ok_or("The project file is damaged")?;
    if end > bytes.len() {
        return Err("The project file is incomplete (it may have been cut off while copying)".into());
    }
    String::from_utf8(bytes[start..end].to_vec()).map_err(|_| "The project file is damaged (text)".to_string())
}

/// The embedded PNG thumbnail, if any.
pub fn thumbnail(bytes: &[u8]) -> Option<&[u8]> {
    let h = read_header(bytes).ok()?;
    if h.thumbnail_len == 0 || HEADER + h.thumbnail_len > bytes.len() {
        return None;
    }
    Some(&bytes[HEADER..HEADER + h.thumbnail_len])
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-png-body";
    #[test]
    fn round_trip() {
        let json = r#"{"app":"Popai Animator","doc":{"name":"Héllo"}}"#;
        let file = encode(json, PNG).unwrap();
        assert!(is_container(&file));
        assert_eq!(project_text(&file).unwrap(), json);
        assert_eq!(thumbnail(&file).unwrap(), PNG);
    }
    #[test]
    fn plain_json_still_opens() {
        assert_eq!(project_text(b"\xEF\xBB\xBF{\"a\":1}").unwrap(), "{\"a\":1}");
        assert!(thumbnail(b"{}").is_none());
    }
    #[test]
    fn rejects_damage() {
        let mut file = encode("{}", PNG).unwrap();
        file.truncate(file.len() - 1);
        assert!(project_text(&file).is_err());
        let mut newer = encode("{}", &[]).unwrap();
        newer[8] = 9;
        assert!(project_text(&newer).unwrap_err().contains("newer"));
        assert!(encode("{}", b"not a png").is_err());
    }
}
