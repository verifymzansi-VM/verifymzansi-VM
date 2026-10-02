"""Generate an original 112.5 BPM electronic music bed; no external samples."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 32000
duration = 16
samples = [0.0] * (rate * duration)
rng = random.Random(22)
beat = 16 / 30

def add(start, length, synth):
    first = int(start * rate)
    for i in range(int(length * rate)):
        pos = first + i
        if pos >= len(samples):
            break
        samples[pos] += synth(i / rate)

def freq(note):
    return 440 * 2 ** ((note - 69) / 12)

for b in range(30):
    start = b * beat
    add(start, 0.25, lambda t: 0.68 * math.exp(-t * 19) * math.sin(2 * math.pi * (46 * t + 7 * (1 - math.exp(-t * 32)))))
    if b % 2:
        add(start, 0.17, lambda t: 0.24 * math.exp(-t * 24) * (rng.uniform(-1, 1) + math.sin(2 * math.pi * 185 * t) * 0.25))
    for half in (0, 0.5):
        add(start + half * beat, 0.07, lambda t: 0.055 * rng.uniform(-1, 1) * math.exp(-t * 65))
    hz = freq([40, 40, 43, 47, 45, 43, 40, 38][b % 8])
    add(start + 0.04, 0.35, lambda t, hz=hz: 0.16 * math.exp(-t * 7) * (math.sin(2 * math.pi * hz * t) + 0.25 * math.sin(2 * math.pi * hz * 2 * t)))
    hz = freq([76, 79, 83, 79, 74, 76, 79, 86][b % 8])
    add(start + beat / 2, 0.26, lambda t, hz=hz: 0.10 * (1 - math.exp(-t * 180)) * math.exp(-t * 13) * (math.sin(2 * math.pi * hz * t) + 0.3 * math.sin(2 * math.pi * hz * 3 * t)))
    if b % 6 == 0:
        add(start, 0.22, lambda t: 0.055 * rng.uniform(-1, 1) * math.exp(-t * 20))

for cut in (3.2, 6.4, 9.6, 12.8):
    add(cut - 0.21, 0.21, lambda t: 0.10 * rng.uniform(-1, 1) * (t / 0.21) ** 2)

output = Path('public/audio/mzansi-discovery-beat.wav')
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    pcm = bytearray()
    for i, value in enumerate(samples):
        fade = min(1, i / (rate * 0.02), (len(samples) - i) / (rate * 0.45))
        pcm.extend(struct.pack('<h', int(math.tanh(value * 1.15) * fade * 28000)))
    wav.writeframes(pcm)
print(output)
