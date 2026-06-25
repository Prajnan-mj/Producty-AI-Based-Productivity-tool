import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export function useVoice({ onResult, onError } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const isSupported = Boolean(SpeechRecognition);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      setError("Speech recognition not supported");
      return;
    }

    setError(null);

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript("");
        setError(null);
      };

      recognition.onaudiostart = () => {
        // Mic is active — confirms permission was granted
      };

      recognition.onresult = (event) => {
        let interim = "";
        let finalText = "";
        let conf = 0;
        for (let i = 0; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) {
            finalText += r[0].transcript;
            conf = Math.max(conf, r[0].confidence);
          } else {
            interim += r[0].transcript;
          }
        }
        setTranscript(finalText || interim);
        if (finalText) {
          onResultRef.current?.({ transcript: finalText.trim(), confidence: conf });
        }
      };

      recognition.onerror = (event) => {
        const msg = {
          "not-allowed": "Microphone permission denied. Allow mic access in your browser settings.",
          "no-speech": "No speech detected. Try again.",
          "audio-capture": "No microphone found. Check your device.",
          "network": "Network error. Check your connection.",
          "aborted": null, // user-initiated, ignore
        }[event.error] || `Speech error: ${event.error}`;

        if (msg) {
          setError(msg);
          onErrorRef.current?.(event);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setError(`Failed to start: ${err.message}`);
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch {}
    };
  }, []);

  return { isListening, transcript, error, startListening, stopListening, isSupported };
}
