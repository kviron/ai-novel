# ComfyUI workflow contract

Export a ComfyUI workflow in API format and keep it local. The future live adapter will map only named inputs from application configuration:

- positive and negative prompt;
- seed, width, and height;
- visual-profile reference images;
- sprite expression or full-scene composition.

Character-sheet jobs run first. Sprite jobs depend on the corresponding sheet. A live workflow must copy completed images into `ASSET_DIR`; arbitrary paths or executable values from the LLM must never be passed to ComfyUI.

No workflow is bundled because checkpoints, custom nodes, and reference-conditioning choices depend on the user's local ComfyUI installation. Demo mode exercises the complete queue and UI without those dependencies.
