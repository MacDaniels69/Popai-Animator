# Composition workspace

Composition sits next to Animation in the top workspace tabs. It combines live animation scenes, footage, image sequences, titles, particles, masks, and effect stacks in the same project.

## Opening and navigating

- Open or create a project, then choose **Composition**.
- The initial composition contains a live **Animation · Mainline** reference. Merely opening the workspace does not change the document or create keys.
- Return to **Animation** to edit drawings, rigs, camera animation, and source keys. The Animation playhead is preserved.
- Use **New composition** for an empty composition. Use the composition picker to navigate existing and nested compositions.
- **Comp settings** exposes name, dimensions, frame rate, end frame, and background. Transparent background works with the alpha viewer and PNG export.

The workspace selection is independent of the existing Setup/Animate rig mode. The existing layer hierarchy and removed Layers & Channels timeline sidebar are not duplicated in Composition.

## Sources and timeline

The Media browser imports images, video, and audio. Media is embedded in the saved `.popai.json` project, matching the existing application's portable project approach. Individual imported files are limited to 256 MB. Browser/WebView codec support determines which video containers/codecs can be decoded; MP4/H.264 and WebM are practical starting points.

**Import image sequence** sorts selected images naturally by filename. `frame_2.png` precedes `frame_10.png`. It creates one sequence clip at the current composition frame rate, with a maximum of 600 images and 256 MB total.

Media can be instantiated more than once. The Media browser also exposes the live Mainline scene, top-level animation layers, and other compositions as sources. Instance effects and keys do not modify source layer/bone/camera channels.

Clips are stacked bottom-to-top; the timeline presents the topmost clip first. Select a lane to edit it. Raise/Lower changes the composite order. Hide disables an ordinary visible clip, while it can still act as an explicitly selected matte source. Duplicate makes independent effect instances and channels. Delete clears dependent matte references in that composition.

The Inspector separates placement from source time:

- **Start:** location on the composition timeline.
- **Duration:** active interval, with an exclusive end (`start + duration`).
- **Source in:** offset measured in composition-timeline frames.
- **Speed:** source-time multiplier; zero freezes a source and negative values reverse it.

Source time is evaluated in seconds, then converted to the animation/precomposition source's frame rate. Video preview and PNG exports use the same awaited seek/decode path. This provides consistent time-based sampling; it is not a replacement for a production frame-indexed FFmpeg decoder, particularly for variable-frame-rate media.

## Effects and looks

The Effects browser contains functioning color correction, exposure, levels, colorize, glow, drop shadow, Gaussian/directional blur, chroma key with spill suppression, luma key, outline, grain, pixelation, chromatic aberration, vignette, and motion echo.

Select a visual clip or adjustment layer, then choose an effect. Its controls appear in the Inspector. Effects process top-to-bottom. Enable/bypass, reorder, reset, and remove controls act on the selected instance. **Reset effect & keys** explicitly removes that effect's parameter channels.

**Save current look as preset** records the current evaluated effect settings. Saved looks are stored in the project and appear in the Effects browser. Applying one adds new independent effect instances; it does not copy source animation or bake pixels.

**Bypass effects** previews the composite without its effects and creates no keys. **Alpha** displays final composite coverage. With an opaque composition background, the final alpha is naturally opaque; use a transparent background to inspect foreground edges.

Canvas processing is currently 8-bit/LDR. This release does not claim HDR or fully color-managed linear-light finishing. Preview and image export share one processing path.

## Adjustment layers, masks, and mattes

An adjustment layer processes the composite beneath it, within the current composition. Its opacity controls the strength of the adjustment using premultiplied-alpha-safe interpolation. Its mask/matte limits the affected region.

Each clip can select another clip as an Alpha, Inverted Alpha, Luma, or Inverted Luma matte. Matte-source effects, transforms, source alpha, and opacity contribute to the coverage. Cycles and missing matte references are rejected.

**Draw polygon mask** places vertices in the viewer; Finish or right-click closes the editing gesture. Vertex handles support dragging and arrow-key nudges (Shift for a larger nudge). Feather and Invert are available. Mask coordinates are explicitly in composition space. They can be keyed; use compatible vertex counts and choose interpolation deliberately when animating masks. This is polygon masking, not a Bézier roto editor or AI rotoscoping.

## Keys and curves

Composition transform/effect keys belong to the composition clip, separately from the source animation.

- With Auto-key off, a previously unanimated property changes statically.
- Auto-key creates keys only for the edited property, anchoring its original value at frame zero when necessary.
- Existing animated channels update at the playhead. The diamond button explicitly adds/removes a key.
- **New keys** selects default interpolation, including Copy Previous. This inherits timing behavior, not the previous value.
- Animated properties appear below the selected clip. Click/right-click a key for settings; Ctrl+Alt+E opens settings for the active parameter's key at the playhead.
- Settings include interpolation, frame, Hold, Interval, Stagger, labels, Bézier values, Noisy amplitude/period, and absolute/relative Cycle controls where applicable.
- Curves displays the active numeric channel using the existing interpolation evaluator.

Changing an instance's opacity, effects, or timing never seeds or replaces Animation channels. Merely navigating the workspace does not bake an animation. The GitHub base does not expose the earlier separate Actions panel implementation; this change does not invent an Action editor or repurpose Mainline channels.

## Point tracking

1. Select a visible footage, image, or animation clip and open **Point tracking**.
2. Choose a frame inside the clip and click **Pick feature in viewer**.
3. Click a textured detail and set the ending frame (up to 300 frames per analysis).
4. Run **Analyze point motion**. Review the saved range. If confidence falls, analysis stops and preserves the reliable portion.
5. Choose a target clip and apply tracked position. The displacement becomes editable X/Y keys on that instance; keys outside the analyzed range remain intact.

This is a bounded normalized-correlation translation tracker. It does not solve scale, rotation, planar perspective, or a 3D camera. Analysis uses the source before its composition effects/matte. Cancellation leaves no partial job applied, and changed sources invalidate results.

## Particles

**Dust burst** and **Sparks** add procedural particle clips at the playhead. Parameters include burst/continuous rate, lifetime, size, direction/spread, speed, gravity, color, and seed. Their effect stacks remain editable.

Particles are analytic: the same time and seed produce the same positions, regardless of playback/scrubbing history. Echo samples earlier source/transform states explicitly. Both therefore render consistently in an image sequence.

## Precompositions

Precompose wraps the selected clip and its matte dependencies in a nested composition. Clip placement and property-key times are offset to preserve the parent result. Absolute cycle targets are offset too. External matte users prevent an unsafe split.

Open a precomposition for editing; use the composition picker to return. Other compositions can be reused from Media. Recursive references are rejected. **Effect flow** is a read-only explanation of processing order, not a second node editor.

## Audio

Playback follows audio/video clips, nested precompositions, and live Animation audio layers, including clip placement, source offsets, rate, gain, and mute. Mainline audio is evaluated without moving the Animation playhead. Reverse and frozen clips do not play mismatched forward audio.

The Composition exporter currently writes PNG frames or a PNG-sequence ZIP with frame-rate metadata. Those formats contain no audio. MP4/WebM encoding with a rendered audio mix remains part of the repository's separate native export stage.

## Assistant

**Assist** provides an explicitly local, deterministic look planner. It recognizes supported requests for film/color looks, glow, grain, blur, shadows, echoes, and green-screen keying. Review its target and proposed effects, then apply them as one undoable edit. Changed scene/selection state requires a fresh review.

No segmentation, cleanup, depth-estimation, relighting, or generative-video service is falsely simulated. Those require an actual model/provider integration.

## Save, undo, and export

Composition metadata is stored in the existing project as a versioned `composition` extension. Media remains in the existing `media` store. Both JavaScript snapshots and Rust history preserve composition data. Old projects need no destructive migration. Missing/recursive references and invalid timing/dimensions are validated at the workspace boundary and on file open.

Use the existing Save/Open/Undo/Redo controls. **Export composition** renders the current composition rather than exporting the original Animation scene. PNG sequence jobs can be cancelled, detect document changes, and impose a 384 MB packaging budget. Choose a shorter range for larger jobs.

## Development and validation

```
cd ui
npm ci
npm run typecheck
npm test
npm run build
```

The composition test suite covers source/key isolation, timing, precomp offsets, dependency cycles, alpha math, keying, tracked motion, particles, nested/source audio, and JSON persistence. `cargo test -p popai-core` also includes a composition-extension preservation check.

The two Electron smoke harnesses in `tests/` exercise the real production React build in a hidden renderer. Run `electron tests/composition-smoke.cjs` and `electron tests/composition-media-smoke.cjs` with a separately installed Electron test runtime. They do not add Electron to the Tauri product. The media check generates its own local fixture footage, tests actual decode/seeks and tracking, and makes no network calls.

Rust/Tauri builds require the prerequisites documented in README. GitHub's Windows workflow runs composition tests, native core checks, and the app build on pull requests and main.
