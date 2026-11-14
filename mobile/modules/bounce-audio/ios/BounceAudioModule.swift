import AVFoundation
import ExpoModulesCore

public class BounceAudioModule: Module {
  private lazy var audio = BounceAudioEngine(
    onMeter: { [weak self] body in self?.sendEvent("onMeter", body) },
    onRouteChange: { [weak self] body in self?.sendEvent("onRouteChange", body) }
  )

  public func definition() -> ModuleDefinition {
    Name("BounceAudio")

    Events("onMeter", "onRouteChange")

    AsyncFunction("requestPermission") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { granted in
          promise.resolve(granted)
        }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
          promise.resolve(granted)
        }
      }
    }

    AsyncFunction("configure") { (sampleRate: Double, bufferFrames: Int) -> [String: Any] in
      try self.audio.configure(sampleRate: sampleRate, bufferFrames: bufferFrames)
    }

    AsyncFunction("getStatus") { () -> [String: Any] in
      self.audio.status()
    }

    AsyncFunction("setFirstInputChannel") { (index: Int) -> [String: Any] in
      self.audio.setFirstInputChannel(index)
      return self.audio.status()
    }

    AsyncFunction("startCapture") {
      try self.audio.startCapture()
    }

    AsyncFunction("stopRecording") { () -> [String: Any] in
      try self.audio.stopRecording()
    }

    AsyncFunction("startLoop") { (uri: String) in
      try self.audio.startLoop(uri: uri)
    }

    AsyncFunction("startOverdub") { (loopUri: String) in
      try self.audio.startOverdub(loopUri: loopUri)
    }

    AsyncFunction("playMix") { (loopUri: String, takeUri: String, compensationMs: Double) in
      try self.audio.playMix(loopUri: loopUri, takeUri: takeUri, compensationMs: compensationMs)
    }

    AsyncFunction("stop") {
      self.audio.stopEverything()
    }

    AsyncFunction("measureLatency") { (promise: Promise) in
      self.audio.measureLatency { result in
        switch result {
        case .success(let value): promise.resolve(value)
        case .failure(let error): promise.reject(error)
        }
      }
    }
  }
}
