//! Windows integration for `.popai` project files, registered for the current user only
//! (HKCU, no admin rights needed):
//! - double-clicking a `.popai` file opens it in Popai Animator,
//! - File Explorer shows the saved camera view as the file's thumbnail.
//!
//! The thumbnail provider DLL (crate `popai-thumbnails`) is embedded in this exe and copied to
//! `%LOCALAPPDATA%\Popai Animator\thumbnails\` on first use, so the portable exe gets it too.
//! Registration runs on every start (cheap, only writes what changed) and from the installer
//! (`--register-file-types`); the uninstaller calls `--unregister-file-types`.

#[cfg_attr(not(windows), allow(dead_code))]
pub const EXTENSION: &str = ".popai";

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const PROGID: &str = "PopaiAnimator.Project";
    /// IThumbnailProvider shell-extension slot.
    const THUMBNAIL_SLOT: &str = "ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}";
    /// Must match `popai_thumbnails::CLSID_TEXT`.
    const CLSID: &str = "{7C3F6A52-4B8E-4D1A-9E2F-5A6B7C8D9E01}";
    static DLL: &[u8] = include_bytes!(env!("POPAI_THUMBS_DLL"));

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event: i32, flags: u32, item1: *const core::ffi::c_void, item2: *const core::ffi::c_void);
    }
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;

    fn fnv1a(bytes: &[u8]) -> u64 {
        bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, &b| (h ^ b as u64).wrapping_mul(0x100_0000_01b3))
    }

    /// Copy the embedded thumbnail DLL out (file name includes its hash, so an update never has to
    /// overwrite a DLL that Explorer currently has loaded).
    fn install_dll() -> Result<Option<PathBuf>, String> {
        if DLL.is_empty() {
            return Ok(None); // built without the thumbnail provider
        }
        let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
        let dir = Path::new(&base).join("Popai Animator").join("thumbnails");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = format!("popai_thumbnails_{:016x}.dll", fnv1a(DLL));
        let path = dir.join(&name);
        if std::fs::metadata(&path).map(|m| m.len() as usize != DLL.len()).unwrap_or(true) {
            let tmp = dir.join(format!("{name}.tmp"));
            std::fs::write(&tmp, DLL).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        }
        // Tidy older copies; ones still loaded by Explorer simply stay until next time.
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("popai_thumbnails_") && n != name {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        Ok(Some(path))
    }

    /// Set a string value; returns true if it changed.
    fn set(root: &RegKey, path: &str, name: &str, value: &str) -> Result<bool, String> {
        let (key, _) = root.create_subkey(path).map_err(|e| format!("registry {path}: {e}"))?;
        if key.get_value::<String, _>(name).ok().as_deref() == Some(value) {
            return Ok(false);
        }
        key.set_value(name, &value.to_string()).map_err(|e| format!("registry {path}: {e}"))?;
        Ok(true)
    }

    pub fn register() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.to_string_lossy().to_string();
        let classes = RegKey::predef(HKEY_CURRENT_USER).create_subkey("Software\\Classes").map_err(|e| e.to_string())?.0;
        let mut changed = false;
        changed |= set(&classes, super::EXTENSION, "", PROGID)?;
        changed |= set(&classes, super::EXTENSION, "Content Type", "application/x-popai-project")?;
        changed |= set(&classes, &format!("{}\\OpenWithProgids", super::EXTENSION), PROGID, "")?;
        changed |= set(&classes, PROGID, "", "Popai Animator Project")?;
        changed |= set(&classes, &format!("{PROGID}\\DefaultIcon"), "", &format!("\"{exe}\",0"))?;
        changed |= set(&classes, &format!("{PROGID}\\shell\\open\\command"), "", &format!("\"{exe}\" \"%1\""))?;
        if let Some(dll) = install_dll()? {
            let dll = dll.to_string_lossy().to_string();
            changed |= set(&classes, &format!("CLSID\\{CLSID}"), "", "Popai Animator thumbnail provider")?;
            changed |= set(&classes, &format!("CLSID\\{CLSID}\\InprocServer32"), "", &dll)?;
            changed |= set(&classes, &format!("CLSID\\{CLSID}\\InprocServer32"), "ThreadingModel", "Apartment")?;
            changed |= set(&classes, &format!("{}\\{THUMBNAIL_SLOT}", super::EXTENSION), "", CLSID)?;
            changed |= set(&classes, &format!("{PROGID}\\{THUMBNAIL_SLOT}"), "", CLSID)?;
        }
        if changed {
            unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, std::ptr::null(), std::ptr::null()) };
        }
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        let classes = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Classes").map_err(|e| e.to_string())?;
        let classes_w = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Software\\Classes", winreg::enums::KEY_ALL_ACCESS)
            .map_err(|e| e.to_string())?;
        let _ = classes_w.delete_subkey_all(PROGID);
        let _ = classes_w.delete_subkey_all(format!("CLSID\\{CLSID}"));
        if classes.open_subkey(super::EXTENSION).and_then(|k| k.get_value::<String, _>("")).ok().as_deref() == Some(PROGID) {
            let _ = classes_w.delete_subkey_all(super::EXTENSION);
        }
        if let Some(base) = std::env::var_os("LOCALAPPDATA") {
            let _ = std::fs::remove_dir_all(Path::new(&base).join("Popai Animator").join("thumbnails"));
        }
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, std::ptr::null(), std::ptr::null()) };
        Ok(())
    }
}

#[cfg(windows)]
pub use imp::{register, unregister};

#[cfg(not(windows))]
pub fn register() -> Result<(), String> {
    Ok(())
}
#[cfg(not(windows))]
pub fn unregister() -> Result<(), String> {
    Ok(())
}
