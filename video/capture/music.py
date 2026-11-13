# Generates the film's music bed with MusicGen (local, free): one ~28 s seed, crossfade-looped to the film length.
import math, sys
import numpy as np, soundfile as sf, torch
from transformers import MusicgenForConditionalGeneration, AutoProcessor

out_path, target_s = sys.argv[1], float(sys.argv[2])
prompt = ("cosy lo-fi acoustic, soft ukulele and warm felt piano, gentle brushed drums, light glockenspiel, "
          "playful and calm morning, studio ghibli feeling, 92 bpm, major key, no vocals")
torch.manual_seed(7)
proc = AutoProcessor.from_pretrained("facebook/musicgen-small")
model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small").eval()
dev = "mps" if torch.backends.mps.is_available() else "cpu"
try:
    model = model.to(dev)
except Exception:
    dev = "cpu"
sr = int(model.config.audio_encoder.sampling_rate)
inputs = {k: v.to(dev) for k, v in proc(text=[prompt], padding=True, return_tensors="pt").items()}
with torch.no_grad():
    audio = model.generate(**inputs, max_new_tokens=int(28 * 50), do_sample=True, guidance_scale=3.0)
seed = audio[0, 0].detach().cpu().numpy().astype("float32")
seed /= max(1e-6, float(np.abs(seed).max())) / 0.89

want = int(round(target_s * sr)); xf = int(0.6 * sr)
out = seed.copy()
t = np.linspace(0, 1, xf, dtype="float32")
while out.shape[0] < want:
    out = np.concatenate([out[:-xf], out[-xf:] * np.cos(t * math.pi / 2) + seed[:xf] * np.sin(t * math.pi / 2), seed[xf:]])
out = out[:want]
fi, fo = int(0.8 * sr), int(2.5 * sr)
out[:fi] *= np.linspace(0, 1, fi, dtype="float32"); out[-fo:] *= np.linspace(1, 0, fo, dtype="float32")
sf.write(out_path, out, sr)
print("wrote", out_path, out.shape[0] / sr, "s on", dev)
