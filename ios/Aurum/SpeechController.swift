import AVFoundation
import MediaPlayer
import UIKit

/// Read-aloud with the iPhone's own voices. Unlike speech inside a web page,
/// it keeps talking with the screen locked, shows on the Lock Screen and in
/// Control Center, and answers AirPods, headphone and CarPlay buttons.
///
/// The page sends a batch of passages (`items`: `[{id, text}]`). Events go
/// back as `{type: "speech", kind, ...}`:
///   - `start` (id): a passage began
///   - `word` (id, start, length): the word being spoken, UTF-16 offsets
///   - `drained`: every passage was spoken; the page sends the next batch
///   - `paused` / `resumed`: changed from the Lock Screen or headphones
///   - `stopped`: stopped from the Lock Screen
final class SpeechController: NSObject, AVSpeechSynthesizerDelegate {
    var onEvent: (([String: Any]) -> Void)?

    private let synthesizer = AVSpeechSynthesizer()
    private var ids: [ObjectIdentifier: Int] = [:]
    private var remaining = 0
    private var title = "Reading aloud"
    private var artist = "Aurum"
    private var commandsInstalled = false
    /// While the app is in the background the page can't run, so word events
    /// are dropped and only the latest passage is reported on return.
    private var heldStart: [String: Any]?

    override init() {
        super.init()
        synthesizer.delegate = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(didBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil
        )
    }

    @objc private func didBecomeActive() {
        if let held = heldStart {
            heldStart = nil
            onEvent?(held)
        }
    }

    /// `{items, voice, rate, pitch, title, artist, replace}`. `rate` and
    /// `pitch` use the web scale (1 = normal).
    func speak(_ body: [String: Any]) {
        let items = body["items"] as? [[String: Any]] ?? []
        if (body["replace"] as? Bool) ?? true {
            ids.removeAll()
            remaining = 0
            synthesizer.stopSpeaking(at: .immediate)
        }
        title = (body["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Reading aloud"
        artist = (body["artist"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Aurum"

        let voiceId = body["voice"] as? String ?? ""
        let voice = voiceId.isEmpty ? nil : AVSpeechSynthesisVoice(identifier: voiceId)
        let rate = (body["rate"] as? NSNumber)?.floatValue ?? 1
        let pitch = (body["pitch"] as? NSNumber)?.floatValue ?? 1

        activateAudio()
        installRemoteCommands()

        for item in items {
            guard let text = item["text"] as? String, !text.isEmpty else { continue }
            let utterance = AVSpeechUtterance(string: text)
            if let voice { utterance.voice = voice }
            // The web's rate 1 is iOS's default rate; scale around it.
            let scaled = AVSpeechUtteranceDefaultSpeechRate * rate
            utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, scaled))
            utterance.pitchMultiplier = min(2, max(0.5, pitch))
            ids[ObjectIdentifier(utterance)] = (item["id"] as? NSNumber)?.intValue ?? 0
            remaining += 1
            synthesizer.speak(utterance)
        }
        if remaining == 0 {
            emit(["kind": "drained"])
            return
        }
        updateNowPlaying(playing: true)
    }

    func pause() {
        synthesizer.pauseSpeaking(at: .word)
        updateNowPlaying(playing: false)
    }

    func resume() {
        activateAudio()
        synthesizer.continueSpeaking()
        updateNowPlaying(playing: true)
    }

    func stop() {
        ids.removeAll()
        remaining = 0
        synthesizer.stopSpeaking(at: .immediate)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: Audio session and Lock Screen

    private func activateAudio() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [])
        try? session.setActive(true)
    }

    private func updateNowPlaying(playing: Bool) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: "Aurum",
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
    }

    private func installRemoteCommands() {
        guard !commandsInstalled else { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.resume()
            self.emit(["kind": "resumed"])
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.pause()
            self.emit(["kind": "paused"])
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.synthesizer.isPaused {
                self.resume()
                self.emit(["kind": "resumed"])
            } else {
                self.pause()
                self.emit(["kind": "paused"])
            }
            return .success
        }
        center.stopCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.stop()
            self.emit(["kind": "stopped"])
            return .success
        }
    }

    private func emit(_ event: [String: Any]) {
        var payload = event
        payload["type"] = "speech"
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let kind = payload["kind"] as? String
            if UIApplication.shared.applicationState != .active, kind == "word" || kind == "start" {
                if kind == "start" { self.heldStart = payload }
                return
            }
            self.onEvent?(payload)
        }
    }

    // MARK: AVSpeechSynthesizerDelegate

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        guard let id = ids[ObjectIdentifier(utterance)] else { return }
        emit(["kind": "start", "id": id])
    }

    func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        guard let id = ids[ObjectIdentifier(utterance)] else { return }
        emit(["kind": "word", "id": id, "start": characterRange.location, "length": characterRange.length])
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard ids.removeValue(forKey: ObjectIdentifier(utterance)) != nil else { return }
        remaining = max(0, remaining - 1)
        if remaining == 0 { emit(["kind": "drained"]) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        ids.removeValue(forKey: ObjectIdentifier(utterance))
    }
}
