# Sound Band Design Studio (SBDS)

An LTX-powered audio production studio inside ComfyUI. This first checkpoint provides the canvas launcher, model setup, and an audio-only generation panel. You can queue a take, follow sampling progress, listen, and download the result.

## Install on a fresh ComfyUI

1. Install and start a current [ComfyUI](https://docs.comfy.org/installation). Use the ComfyUI user data directory if your installation keeps custom nodes outside the application directory.
2. In its `custom_nodes` directory, install SBDS and the upstream LTX node pack:

   ```sh
   git clone https://github.com/maisamh80/sound-band-design-studio.git
   git clone https://github.com/Lightricks/ComfyUI-LTXVideo.git
   ```

   If the LTX pack is already installed, use that copy. Install its dependencies with the Python environment used by ComfyUI, or install it through ComfyUI Manager. For a manual install, run `python -m pip install -r ComfyUI-LTXVideo/requirements.txt` from `custom_nodes` using ComfyUI's Python.

3. Install a matching LTX 2.5 distilled diffusion model, LTX text encoder, and Audio VAE in the folders below. Follow the [upstream Text-to-Audio guide](https://docs.ltx.io/open-source-model/usage-guides/text-to-audio/) for compatible downloads and filenames.

   | ComfyUI model folder | Component |
   | --- | --- |
   | `models/diffusion_models/` | LTX 2.5 distilled transformer |
   | `models/text_encoders/` | LTX 2.5 Gemma text encoder with projection |
   | `models/vae/` | LTX 2.5 Audio VAE |

4. Restart ComfyUI and refresh the browser. Add **SBDS · Sound Band Design Studio** and click **Open Studio**. Verify the model files under **Settings → Model setup**.

SBDS itself has no extra pip or npm dependencies. Model weights stay in your ComfyUI installation. Use an appropriate quantization and the ComfyUI memory settings for your hardware. The development workflow uses an INT8 transformer and text encoder. Start with a short sample when testing a new installation.

## First smoke run

1. Select **Sound Effect** and try “A soft, steady rain patters on leaves in a forest. No thunder or speech.”
2. Keep the duration at 5 seconds and Generation FPS at 24. Under **Generation settings**, keep 8 steps, `uni_pc`, `simple`, and CFG 1.
3. Click **Generate**. Check the progress bar and elapsed time, then play or download the FLAC. ComfyUI stores it under `output/audio/SBDS/`.

The model FPS and target seconds determine the latent frame count. They are separate from the decoded audio sample rate. At CFG 1, the default guider may ignore the negative prompt.

SBDS requests a ComfyUI memory cleanup after saving each take. ComfyUI unloads its models and clears its execution cache between jobs, so the next take may take longer to start.

For a voice, enter a description or a line in quotation marks and choose its traits under **Voice design**. **Final Prompt** shows the text that will be sent to LTX. Saved edits apply to that generated prompt in this browser. Use **Reset to generated** and save to clear the edit. Choose **Custom** in the language menu to enter a language by name.

## Development checkpoints

1. Verify Text-to-Audio on a clean ComfyUI installation.
2. Add the project store and voice library, then validate reference dialogue with one and two AVref speakers.
3. Add the script tag compiler, timeline, and mixdown and multitrack WAV export.

Reference dialogue, project persistence, and the timeline are planned for later checkpoints. See the [Licon AVref documentation](https://github.com/liconstudio/ComfyUI-LTX2.5-MSR/blob/main/README-AVref.md) for the reference pipeline's image-slot dependency.

## License

The SBDS code uses the MIT license. Upstream node packs and model weights have their own terms.
