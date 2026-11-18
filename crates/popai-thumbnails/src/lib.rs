//! File Explorer thumbnails for `.popai` projects.
//!
//! Popai Animator stores a PNG of the camera view at the front of every `.popai` file
//! (see the `popai-format` crate). This DLL is a standard Windows thumbnail provider
//! (`IThumbnailProvider` + `IInitializeWithStream`): Explorer hands it the file as a stream,
//! it reads only the header and the PNG, and returns a bitmap. It never parses the project itself.
//!
//! The app registers it per user (HKCU, no admin rights) when it starts or when the installer
//! runs `popai-animator.exe --register-file-types`.

/// Class id of the thumbnail provider. Must match the app's registration code.
pub const CLSID_TEXT: &str = "{7C3F6A52-4B8E-4D1A-9E2F-5A6B7C8D9E01}";

/// Decoded thumbnail, ready for a 32-bit top-down DIB: BGRA, straight (not premultiplied) alpha.
pub struct Bgra {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Decode the PNG and shrink it so its longer side is at most `max_side` (Explorer asks for e.g. 256).
pub fn decode_thumbnail(png_bytes: &[u8], max_side: u32) -> Result<Bgra, String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let (w, h) = (reader.info().width, reader.info().height);
    if w == 0 || h == 0 || w > 8192 || h > 8192 {
        return Err("thumbnail size".into());
    }
    let mut buf = vec![0; reader.output_buffer_size().ok_or("thumbnail size")?];
    let frame = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let data = &buf[..frame.buffer_size()];
    let rgba: Vec<u8> = match frame.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => data.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("unexpanded palette".into()),
    };
    let max_side = max_side.clamp(16, 2048);
    let scale = (max_side as f64 / w.max(h) as f64).min(1.0);
    let (tw, th) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
    let mut out = Vec::with_capacity((tw * th * 4) as usize);
    // Box filter: average every source pixel that falls inside each target pixel.
    for ty in 0..th {
        let (y0, y1) = ((ty * h / th) as usize, (((ty + 1) * h / th).max(ty * h / th + 1)) as usize);
        for tx in 0..tw {
            let (x0, x1) = ((tx * w / tw) as usize, (((tx + 1) * w / tw).max(tx * w / tw + 1)) as usize);
            let mut acc = [0u64; 4];
            for y in y0..y1.min(h as usize) {
                for x in x0..x1.min(w as usize) {
                    let i = (y * w as usize + x) * 4;
                    let a = rgba[i + 3] as u64;
                    acc[0] += rgba[i] as u64 * a;
                    acc[1] += rgba[i + 1] as u64 * a;
                    acc[2] += rgba[i + 2] as u64 * a;
                    acc[3] += a;
                }
            }
            let n = ((y1.min(h as usize) - y0) * (x1.min(w as usize) - x0)).max(1) as u64;
            let (r, g, b) = if acc[3] > 0 { (acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]) } else { (0, 0, 0) };
            out.extend_from_slice(&[b as u8, g as u8, r as u8, (acc[3] / n) as u8]);
        }
    }
    Ok(Bgra { width: tw, height: th, pixels: out })
}

#[cfg(windows)]
mod com {
    use super::*;
    use std::ffi::c_void;
    use std::sync::Mutex;
    use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_POINTER, E_UNEXPECTED, S_FALSE};
    use windows::Win32::Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP};
    use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl, IStream};
    use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
    use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_ARGB, WTS_ALPHATYPE};
    use windows_core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT};

    pub const CLSID: GUID = GUID::from_u128(0x7c3f6a52_4b8e_4d1a_9e2f_5a6b7c8d9e01);

    fn read_exact(stream: &IStream, buf: &mut [u8]) -> windows_core::Result<()> {
        let mut done = 0usize;
        while done < buf.len() {
            let mut got = 0u32;
            let want = (buf.len() - done).min(1 << 20) as u32;
            unsafe { stream.Read(buf[done..].as_mut_ptr() as *mut c_void, want, Some(&mut got)).ok()? };
            if got == 0 {
                return Err(E_FAIL.into());
            }
            done += got as usize;
        }
        Ok(())
    }

    #[implement(IInitializeWithStream, IThumbnailProvider)]
    struct Provider {
        stream: Mutex<Option<IStream>>,
    }

    impl IInitializeWithStream_Impl for Provider_Impl {
        fn Initialize(&self, pstream: Ref<IStream>, _grfmode: u32) -> windows_core::Result<()> {
            let mut slot = self.stream.lock().map_err(|_| windows_core::Error::from(E_UNEXPECTED))?;
            if slot.is_some() {
                return Err(E_UNEXPECTED.into());
            }
            *slot = Some(pstream.ok()?.clone());
            Ok(())
        }
    }

    impl IThumbnailProvider_Impl for Provider_Impl {
        fn GetThumbnail(&self, cx: u32, phbmp: *mut HBITMAP, pdwalpha: *mut WTS_ALPHATYPE) -> windows_core::Result<()> {
            if phbmp.is_null() || pdwalpha.is_null() {
                return Err(E_POINTER.into());
            }
            let stream = self.stream.lock().map_err(|_| windows_core::Error::from(E_UNEXPECTED))?.clone().ok_or(windows_core::Error::from(E_UNEXPECTED))?;
            let mut header = [0u8; popai_format::HEADER];
            read_exact(&stream, &mut header)?;
            let info = popai_format::read_header(&header).map_err(|_| windows_core::Error::from(E_FAIL))?;
            if info.thumbnail_len == 0 {
                return Err(E_FAIL.into());
            }
            let mut png_bytes = vec![0u8; info.thumbnail_len];
            read_exact(&stream, &mut png_bytes)?;
            let img = decode_thumbnail(&png_bytes, cx).map_err(|_| windows_core::Error::from(E_FAIL))?;

            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: img.width as i32,
                    biHeight: -(img.height as i32), // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bmp = unsafe { CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0)? };
            if bits.is_null() {
                return Err(E_FAIL.into());
            }
            unsafe {
                std::ptr::copy_nonoverlapping(img.pixels.as_ptr(), bits as *mut u8, img.pixels.len());
                *phbmp = bmp;
                *pdwalpha = WTSAT_ARGB;
            }
            Ok(())
        }
    }

    #[implement(IClassFactory)]
    struct Factory;

    impl IClassFactory_Impl for Factory_Impl {
        fn CreateInstance(&self, punkouter: Ref<IUnknown>, riid: *const GUID, ppvobject: *mut *mut c_void) -> windows_core::Result<()> {
            if ppvobject.is_null() {
                return Err(E_POINTER.into());
            }
            unsafe { *ppvobject = std::ptr::null_mut() };
            if punkouter.is_some() {
                return Err(CLASS_E_NOAGGREGATION.into());
            }
            let unknown: IUnknown = Provider { stream: Mutex::new(None) }.into();
            unsafe { unknown.query(riid, ppvobject).ok() }
        }
        fn LockServer(&self, _flock: BOOL) -> windows_core::Result<()> {
            Ok(())
        }
    }

    #[no_mangle]
    extern "system" fn DllGetClassObject(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
        if rclsid.is_null() || riid.is_null() || ppv.is_null() {
            return E_POINTER;
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if unsafe { *rclsid } != CLSID {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let factory: IClassFactory = Factory.into();
        unsafe { factory.query(riid, ppv) }
    }

    #[no_mangle]
    extern "system" fn DllCanUnloadNow() -> HRESULT {
        S_FALSE // stay loaded; Explorer's thumbnail host process is short-lived anyway
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().unwrap().write_image_data(rgba).unwrap();
        out
    }
    #[test]
    fn decodes_and_shrinks_to_requested_size() {
        let (w, h) = (400, 200);
        let px: Vec<u8> = (0..w * h).flat_map(|_| [255u8, 0, 0, 255]).collect();
        let img = decode_thumbnail(&png(w, h, &px), 100).unwrap();
        assert_eq!((img.width, img.height), (100, 50));
        assert_eq!(&img.pixels[..4], &[0, 0, 255, 255]); // red, stored as BGRA
    }
    #[test]
    fn reads_thumbnail_out_of_a_project_file() {
        let px = [10u8, 20, 30, 255, 40, 50, 60, 255];
        let file = popai_format::encode("{}", &png(2, 1, &px)).unwrap();
        let img = decode_thumbnail(popai_format::thumbnail(&file).unwrap(), 256).unwrap();
        assert_eq!((img.width, img.height), (2, 1));
        assert_eq!(&img.pixels, &[30, 20, 10, 255, 60, 50, 40, 255]);
    }
}
