import AVFoundation
import Accelerate
import ExpoModulesCore

final class AudioException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

/// What the input tap is currently feeding. One tap is active at a time.
private final class Tap {
  let url: URL?
  var file: AVAudioFile?
  /// Samples timestamped before this host time (seconds) are dropped, so the
  /// recording's first frame lines up with a known point on the playback timeline.
  var gateHostSec: Double?
  var collectMono: Bool
  var mono: [Float] = []
  var frames: Int = 0
  var started = false
  var lateFrames = 0
  var peak: Float = 0
  var clipped = false
  var meterPeaks: [Float] = []
  var lastMeter: Double = 0
  let sampleRate: Double
  /// Channels kept from the hardware input, starting at `firstChannel`. At most two.
  let channels: Int
  let firstChannel: Int
  let format: AVAudioFormat

  init(url: URL?, file: AVAudioFile?, format: AVAudioFormat, firstChannel: Int, gateHostSec: Double?, collectMono: Bool) {
    self.url = url
    self.file = file
    self.gateHostSec = gateHostSec
    self.collectMono = collectMono
    self.sampleRate = format.sampleRate
    self.channels = Int(format.channelCount)
    self.firstChannel = firstChannel
    self.format = format
    self.meterPeaks = Array(repeating: 0, count: Int(format.channelCount))
  }
}

/// Spike audio engine: capture the input to a 24-bit WAV, loop it, overdub a
/// take in time with the loop, and measure round-trip latency.
final class BounceAudioEngine {
  private let engine = AVAudioEngine()
  private let loopPlayer = AVAudioPlayerNode()
  private let takePlayer = AVAudioPlayerNode()
  private let lock = NSLock()
  private var tap: Tap?
  /// Which hardware input channel the recording starts at. Interfaces with more than two
  /// inputs put the signal on a pair of their choosing, so it has to be selectable.
  private var firstInputChannel = 0
  private var observers: [NSObjectProtocol] = []
  private let onMeter: ([String: Any]) -> Void
  private let onRouteChange: ([String: Any]) -> Void

  init(onMeter: @escaping ([String: Any]) -> Void, onRouteChange: @escaping ([String: Any]) -> Void) {
    self.onMeter = onMeter
    self.onRouteChange = onRouteChange
    engine.attach(loopPlayer)
    engine.attach(takePlayer)

    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] _ in
      guard let self else { return }
      self.preferStereoInput()
      self.onRouteChange(self.status())
    })
    // The engine stops itself when the hardware format changes (for example a USB device is plugged in).
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
      guard let self else { return }
      self.stopEverything()
      self.onRouteChange(self.status())
    })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  // MARK: Session

  func configure(sampleRate: Double, bufferFrames: Int) throws -> [String: Any] {
    stopEverything()
    let session = AVAudioSession.sharedInstance()
    // .measurement turns off the system's voice processing and gain control, which would colour a music signal.
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
    try session.setPreferredSampleRate(sampleRate)
    try session.setPreferredIOBufferDuration(Double(bufferFrames) / sampleRate)
    try session.setActive(true)
    preferStereoInput()
    return status()
  }

  private func preferStereoInput() {
    let session = AVAudioSession.sharedInstance()
    let maxIn = session.maximumInputNumberOfChannels
    if maxIn > 0 {
      try? session.setPreferredInputNumberOfChannels(min(2, maxIn))
    }
  }

  func status() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    func ports(_ list: [AVAudioSessionPortDescription]) -> [[String: Any]] {
      list.map { ["name": $0.portName, "type": $0.portType.rawValue, "channels": $0.channels?.count ?? 0] }
    }
    let rate = session.sampleRate
    return [
      "inputs": ports(session.currentRoute.inputs),
      "outputs": ports(session.currentRoute.outputs),
      "sampleRate": rate,
      "ioBufferFrames": Int((session.ioBufferDuration * rate).rounded()),
      "ioBufferMs": session.ioBufferDuration * 1000,
      "inputLatencyMs": session.inputLatency * 1000,
      "outputLatencyMs": session.outputLatency * 1000,
      "inputChannels": session.inputNumberOfChannels,
      "maxInputChannels": session.maximumInputNumberOfChannels,
      "outputChannels": session.outputNumberOfChannels,
      "hardwareInputChannels": Int(engine.inputNode.outputFormat(forBus: 0).channelCount),
      "firstInputChannel": firstInputChannel,
      "engineRunning": engine.isRunning,
    ]
  }

  func setFirstInputChannel(_ index: Int) {
    stopEverything()
    firstInputChannel = max(0, index)
  }

  // MARK: Capture

  func startCapture() throws {
    stopEverything()
    let (hardware, format, first) = try inputFormats()
    let url = newFileURL(prefix: "beat")
    let file = try AVAudioFile(forWriting: url, settings: wavSettings(format), commonFormat: .pcmFormatFloat32, interleaved: false)
    installTap(Tap(url: url, file: file, format: format, firstChannel: first, gateHostSec: nil, collectMono: false), format: hardware)
    try ensureRunning()
  }

  func stopRecording() throws -> [String: Any] {
    guard let tap = removeTap(), let url = tap.url else {
      throw AudioException("Nothing is recording.")
    }
    loopPlayer.stop()
    tap.file = nil // closes the file
    return [
      "uri": url.absoluteString,
      "durationSec": Double(tap.frames) / tap.sampleRate,
      "sampleRate": tap.sampleRate,
      "channels": tap.channels,
      "bitDepth": 24,
      "peakDb": decibels(tap.peak),
      "clipped": tap.clipped,
      "lateMs": Double(tap.lateFrames) / tap.sampleRate * 1000,
    ]
  }

  // MARK: Loop and overdub

  func startLoop(uri: String) throws {
    stopEverything()
    let buffer = try loadBuffer(uri)
    try connect(loopPlayer, format: buffer.format)
    loopPlayer.scheduleBuffer(buffer, at: nil, options: .loops)
    loopPlayer.play()
  }

  /// Plays the loop from a known host time and records the input from that same instant,
  /// so frame 0 of the take corresponds to frame 0 of the loop (before latency compensation).
  func startOverdub(loopUri: String) throws {
    stopEverything()
    let buffer = try loadBuffer(loopUri)
    let (hardware, format, first) = try inputFormats()
    let url = newFileURL(prefix: "take")
    let file = try AVAudioFile(forWriting: url, settings: wavSettings(format), commonFormat: .pcmFormatFloat32, interleaved: false)
    let tap = Tap(url: url, file: file, format: format, firstChannel: first, gateHostSec: .infinity, collectMono: false)
    installTap(tap, format: hardware)
    try connect(loopPlayer, format: buffer.format)

    let startHost = mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.3)
    lock.lock()
    tap.gateHostSec = AVAudioTime.seconds(forHostTime: startHost)
    lock.unlock()
    loopPlayer.scheduleBuffer(buffer, at: nil, options: .loops)
    loopPlayer.play(at: AVAudioTime(hostTime: startHost))
  }

  /// Plays the loop with the take on top. A positive compensation skips that much of the
  /// start of the take (it was recorded late by the round-trip latency); negative delays it.
  func playMix(loopUri: String, takeUri: String, compensationMs: Double) throws {
    stopEverything()
    let loop = try loadBuffer(loopUri)
    guard let takeURL = URL(string: takeUri) else { throw AudioException("Bad take file address.") }
    let take = try AVAudioFile(forReading: takeURL)
    let rate = take.processingFormat.sampleRate
    let skip = max(0, AVAudioFramePosition((compensationMs / 1000 * rate).rounded()))
    guard take.length > skip else { throw AudioException("The take is shorter than the compensation.") }

    try connect(loopPlayer, format: loop.format)
    try connect(takePlayer, format: take.processingFormat)

    let startHost = mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.2)
    let delayHost = AVAudioTime.hostTime(forSeconds: max(0, -compensationMs / 1000))
    loopPlayer.scheduleBuffer(loop, at: nil, options: .loops)
    takePlayer.scheduleSegment(take, startingFrame: skip, frameCount: AVAudioFrameCount(take.length - skip), at: nil)
    loopPlayer.play(at: AVAudioTime(hostTime: startHost))
    takePlayer.play(at: AVAudioTime(hostTime: startHost + delayHost))
  }

  func stopEverything() {
    _ = removeTap()
    loopPlayer.stop()
    takePlayer.stop()
    // Every operation rebuilds the graph (tap, player formats) from a stopped engine.
    // Changing it while running left players in a state where starting them raised an exception.
    engine.stop()
  }

  // MARK: Latency test

  /// Plays a train of clicks and listens for them on the input. The gap between when a click
  /// was scheduled and when it shows up in the recording is the round-trip latency the
  /// overdub needs to compensate for.
  func measureLatency(completion: @escaping (Result<[String: Any], Error>) -> Void) {
    stopEverything()
    let clickCount = 6
    let firstClick = 0.5
    let spacing = 0.4
    let total = firstClick + spacing * Double(clickCount) + 0.3

    do {
      let (hardware, format, first) = try inputFormats()
      let outRate = engine.mainMixerNode.outputFormat(forBus: 0).sampleRate
      guard
        outRate > 0,
        let clickFormat = AVAudioFormat(standardFormatWithSampleRate: outRate, channels: 2),
        let clicks = AVAudioPCMBuffer(pcmFormat: clickFormat, frameCapacity: AVAudioFrameCount(total * outRate)),
        let data = clicks.floatChannelData
      else { throw AudioException("No audio output is available.") }
      clicks.frameLength = clicks.frameCapacity
      memset(data[0], 0, Int(clicks.frameLength) * MemoryLayout<Float>.size)
      memset(data[1], 0, Int(clicks.frameLength) * MemoryLayout<Float>.size)
      let burst = Int(0.003 * outRate) // 3 ms of 3 kHz: a sharp onset that survives a phone speaker
      for k in 0..<clickCount {
        let start = Int((firstClick + spacing * Double(k)) * outRate)
        for i in 0..<burst {
          let sample = 0.9 * sinf(2 * .pi * 3000 * Float(i) / Float(outRate))
          data[0][start + i] = sample
          data[1][start + i] = sample
        }
      }

      let tap = Tap(url: nil, file: nil, format: format, firstChannel: first, gateHostSec: .infinity, collectMono: true)
      installTap(tap, format: hardware)
      try connect(loopPlayer, format: clickFormat)

      let startHost = mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.3)
      lock.lock()
      tap.gateHostSec = AVAudioTime.seconds(forHostTime: startHost)
      lock.unlock()
      loopPlayer.scheduleBuffer(clicks, at: nil, options: [])
      loopPlayer.play(at: AVAudioTime(hostTime: startHost))

      DispatchQueue.global().asyncAfter(deadline: .now() + 0.3 + total + 0.2) { [weak self] in
        guard let self else { return }
        guard let done = self.removeTap(), done === tap else {
          completion(.failure(AudioException("The latency test was interrupted.")))
          return
        }
        self.loopPlayer.stop()
        self.saveLatencyCapture(done.mono, rate: done.sampleRate)
        completion(.success(self.analyseClicks(done.mono, rate: done.sampleRate, first: firstClick, spacing: spacing, count: clickCount)))
      }
    } catch {
      stopEverything()
      completion(.failure(error))
    }
  }

  /// Keeps what the latency test heard, so a surprising result can be inspected in an audio editor.
  private func saveLatencyCapture(_ samples: [Float], rate: Double) {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("latency-test.wav")
    guard
      !samples.isEmpty,
      let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
      let file = try? AVAudioFile(forWriting: url, settings: wavSettings(format), commonFormat: .pcmFormatFloat32, interleaved: false)
    else { return }
    samples.withUnsafeBufferPointer { src in
      buffer.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
    }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    try? file.write(from: buffer)
  }

  private func analyseClicks(_ samples: [Float], rate: Double, first: Double, spacing: Double, count: Int) -> [String: Any] {
    // Everything before the first click is room noise.
    let quietEnd = min(samples.count, Int((first - 0.1) * rate))
    var noise: Float = 0
    if quietEnd > 0 {
      samples.withUnsafeBufferPointer { vDSP_maxmgv($0.baseAddress!, 1, &noise, vDSP_Length(quietEnd)) }
    }
    let threshold = max(0.01, noise * 6)

    var values: [Double] = []
    for k in 0..<count {
      let expected = Int((first + spacing * Double(k)) * rate)
      let end = min(samples.count, expected + Int((spacing - 0.05) * rate))
      guard expected < end else { continue }
      var peak: Float = 0
      for i in expected..<end { peak = max(peak, abs(samples[i])) }
      guard peak > threshold else { continue }
      if let onset = (expected..<end).first(where: { abs(samples[$0]) >= peak * 0.5 }) {
        values.append(Double(onset - expected) / rate * 1000)
      }
    }
    values.sort()
    let session = AVAudioSession.sharedInstance()
    var result: [String: Any] = [
      "detected": values.count,
      "clicks": count,
      "valuesMs": values,
      "noiseFloorDb": decibels(noise),
      "reportedMs": (session.inputLatency + session.outputLatency + session.ioBufferDuration * 2) * 1000,
    ]
    if !values.isEmpty {
      result["medianMs"] = values[values.count / 2]
      result["minMs"] = values.first!
      result["maxMs"] = values.last!
    }
    return result
  }

  // MARK: Input tap

  private func installTap(_ newTap: Tap, format: AVAudioFormat) {
    lock.lock()
    tap = newTap
    lock.unlock()
    engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, when in
      self?.handle(buffer, when)
    }
  }

  /// Removes the tap before taking the lock: removal can wait on an in-flight callback, which needs the lock.
  private func removeTap() -> Tap? {
    lock.lock()
    let hadTap = tap != nil
    lock.unlock()
    if hadTap {
      engine.inputNode.removeTap(onBus: 0)
    }
    lock.lock()
    defer { lock.unlock() }
    let old = tap
    tap = nil
    return old
  }

  private func handle(_ buffer: AVAudioPCMBuffer, _ when: AVAudioTime) {
    lock.lock()
    defer { lock.unlock() }
    guard let tap, let all = buffer.floatChannelData else { return }
    guard tap.firstChannel + tap.channels <= Int(buffer.format.channelCount) else { return }
    let channels = all + tap.firstChannel
    let count = Int(buffer.frameLength)
    var offset = 0

    if let gate = tap.gateHostSec, !tap.started {
      guard when.isHostTimeValid, gate.isFinite else { return }
      let bufferStart = AVAudioTime.seconds(forHostTime: when.hostTime)
      let skip = Int(((gate - bufferStart) * tap.sampleRate).rounded())
      if skip >= count { return }
      if skip < 0 { tap.lateFrames = -skip }
      offset = max(0, skip)
    }
    tap.started = true
    let length = count - offset
    guard length > 0 else { return }

    for c in 0..<tap.channels {
      var peak: Float = 0
      vDSP_maxmgv(channels[c] + offset, 1, &peak, vDSP_Length(length))
      tap.meterPeaks[c] = max(tap.meterPeaks[c], peak)
      tap.peak = max(tap.peak, peak)
      if peak >= 0.999 { tap.clipped = true }
    }

    if let file = tap.file, let out = AVAudioPCMBuffer(pcmFormat: tap.format, frameCapacity: AVAudioFrameCount(length)), let dst = out.floatChannelData {
      for c in 0..<tap.channels {
        memcpy(dst[c], channels[c] + offset, length * MemoryLayout<Float>.size)
      }
      out.frameLength = AVAudioFrameCount(length)
      try? file.write(from: out)
    }
    if tap.collectMono {
      let scale = 1 / Float(tap.channels)
      for i in offset..<count {
        var sum: Float = 0
        for c in 0..<tap.channels { sum += channels[c][i] }
        tap.mono.append(sum * scale)
      }
    }
    tap.frames += length

    let now = CACurrentMediaTime()
    if tap.file != nil, now - tap.lastMeter >= 0.05 {
      tap.lastMeter = now
      onMeter([
        "peaksDb": tap.meterPeaks.map { decibels($0) },
        "clipped": tap.clipped,
        "seconds": Double(tap.frames) / tap.sampleRate,
      ])
      for c in 0..<tap.channels { tap.meterPeaks[c] = 0 }
    }
  }

  // MARK: Helpers

  /// Wires a player to the mixer, then starts the engine. Call after any tap is installed.
  private func connect(_ player: AVAudioPlayerNode, format: AVAudioFormat) throws {
    engine.connect(player, to: engine.mainMixerNode, format: format)
    try ensureRunning()
    guard !engine.outputConnectionPoints(for: player, outputBus: 0).isEmpty else {
      throw AudioException("The audio engine could not connect playback. Try again.")
    }
  }

  private func ensureRunning() throws {
    if !engine.isRunning {
      engine.prepare()
      try engine.start()
    }
  }

  /// The hardware input format the tap must use, the mono or stereo format that gets recorded,
  /// and the hardware channel the recording starts at.
  private func inputFormats() throws -> (hardware: AVAudioFormat, record: AVAudioFormat, first: Int) {
    let hardware = engine.inputNode.outputFormat(forBus: 0)
    let available = Int(hardware.channelCount)
    guard hardware.sampleRate > 0, available > 0 else {
      throw AudioException("No audio input is available. Check microphone permission and the input route.")
    }
    let kept = min(2, available)
    let first = min(firstInputChannel, available - kept)
    guard let record = AVAudioFormat(standardFormatWithSampleRate: hardware.sampleRate, channels: AVAudioChannelCount(kept)) else {
      throw AudioException("The input format is not supported.")
    }
    return (hardware, record, first)
  }

  private func wavSettings(_ format: AVAudioFormat) -> [String: Any] {
    [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
      AVLinearPCMBitDepthKey: 24,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
    ]
  }

  private func newFileURL(prefix: String) -> URL {
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let stamp = Int(Date().timeIntervalSince1970)
    return dir.appendingPathComponent("\(prefix)-\(stamp).wav")
  }

  private func loadBuffer(_ uri: String) throws -> AVAudioPCMBuffer {
    guard let url = URL(string: uri) else { throw AudioException("Bad file address.") }
    let file = try AVAudioFile(forReading: url)
    guard file.length > 0, let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
      throw AudioException("The recording is empty.")
    }
    try file.read(into: buffer)
    return buffer
  }

  private func decibels(_ linear: Float) -> Double {
    linear <= 0.00001 ? -100 : Double(20 * log10(linear))
  }
}
