// The vision model. Everything model-specific lives here, so swapping models
// only touches this file. Chosen in stage 2; see docs/vision-models.md.
import {
  AutoProcessor,
  Florence2ForConditionalGeneration,
  type Florence2Processor,
  type ProgressInfo,
  type RawImage,
  type Tensor,
} from "@huggingface/transformers";
import type { Backend } from "./protocol";

export type Captioner = (image: RawImage) => Promise<string>;

const MODEL_ID = "onnx-community/Florence-2-base-ft";
// Pinned so the weights can't change under us. Update deliberately.
const REVISION = "e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f";
// Short caption task: one sentence, and the best of the tested prompts at
// naming which lamp of a traffic light is lit.
const TASK = "<CAPTION>";

// fp16 parts need WebGPU; Wasm gets 8-bit versions (fp16 is slow on CPU).
// Download: ~357 MB on WebGPU, ~228 MB on Wasm.
const DTYPES = {
  webgpu: { embed_tokens: "fp16", vision_encoder: "fp16", encoder_model: "q4", decoder_model_merged: "q4" },
  wasm: { embed_tokens: "q8", vision_encoder: "q8", encoder_model: "q4", decoder_model_merged: "q4" },
} as const;

export async function loadCaptioner(
  backend: Backend,
  onProgress: (file: string, loaded: number, total: number) => void,
): Promise<Captioner> {
  const progress_callback = (p: ProgressInfo) => {
    if (p.status === "progress") onProgress(p.file, p.loaded, p.total);
  };
  const [model, processor] = await Promise.all([
    Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      revision: REVISION,
      device: backend,
      dtype: DTYPES[backend],
      progress_callback,
    }),
    AutoProcessor.from_pretrained(MODEL_ID, { revision: REVISION, progress_callback }) as Promise<Florence2Processor>,
  ]);

  const prompts = processor.construct_prompts(TASK);
  return async (image) => {
    const inputs = await processor(image, prompts);
    // Without return_dict_in_generate, generate() returns the token ids.
    const ids = (await model.generate({ ...inputs, max_new_tokens: 60, do_sample: false })) as Tensor;
    const text = processor.batch_decode(ids, { skip_special_tokens: false })[0] ?? "";
    const result = processor.post_process_generation(text, TASK, [image.width, image.height]);
    return String(result[TASK] ?? "");
  };
}
