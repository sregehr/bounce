// Runs on the audio thread. Reports a peak per input channel and forwards the selected
// stereo pair to the main thread in 2048-frame blocks, each stamped with the audio
// clock frame of its first sample so recordings can be lined up with playback exactly.
const BLOCK = 2048

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pair = 0
    this.peaks = new Float32Array(0)
    this.l = new Float32Array(BLOCK)
    this.r = new Float32Array(BLOCK)
    this.fill = 0
    this.blockFrame = 0
    this.port.onmessage = (e) => {
      if (typeof e.data.pair === 'number') this.pair = e.data.pair
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channels = input.length
    const frames = input[0].length
    if (this.peaks.length !== channels) this.peaks = new Float32Array(channels)

    for (let c = 0; c < channels; c++) {
      const data = input[c]
      let peak = this.peaks[c]
      for (let i = 0; i < frames; i++) {
        const v = data[i] < 0 ? -data[i] : data[i]
        if (v > peak) peak = v
      }
      this.peaks[c] = peak
    }

    const li = Math.min(this.pair * 2, channels - 1)
    const left = input[li]
    const right = input[Math.min(li + 1, channels - 1)]
    let offset = 0
    while (offset < frames) {
      if (this.fill === 0) this.blockFrame = currentFrame + offset
      const n = Math.min(frames - offset, BLOCK - this.fill)
      this.l.set(left.subarray(offset, offset + n), this.fill)
      this.r.set(right.subarray(offset, offset + n), this.fill)
      this.fill += n
      offset += n
      if (this.fill === BLOCK) {
        const l = this.l
        const r = this.r
        const peaks = this.peaks
        this.port.postMessage({ peaks, l, r, pair: this.pair, frame: this.blockFrame }, [l.buffer, r.buffer, peaks.buffer])
        this.l = new Float32Array(BLOCK)
        this.r = new Float32Array(BLOCK)
        this.peaks = new Float32Array(channels)
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('capture', CaptureProcessor)
