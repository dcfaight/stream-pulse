'use client';

import { createSessionClient, type SessionClient } from '@stream-pulse/webrtc-sdk';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface LoopbackHandle {
  senderPeer: RTCPeerConnection;
  receiverPeer: RTCPeerConnection;
  stream: MediaStream;
  stop: () => void;
}

function createCanvasStream(): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create canvas context');
  }

  let frame = 0;
  const timer = window.setInterval(() => {
    frame += 1;
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#22c55e';
    context.font = '24px system-ui';
    context.fillText('StreamPulse loopback demo', 32, 56);
    context.fillStyle = '#f8fafc';
    context.fillText(`Frame: ${frame}`, 32, 104);
    context.fillText(`Time: ${new Date().toLocaleTimeString()}`, 32, 152);
    context.fillStyle = '#38bdf8';
    context.fillRect((frame * 7) % canvas.width, 210, 90, 40);
  }, 1000 / 15);

  const stream = canvas.captureStream(15);
  return {
    stream,
    stop: () => {
      clearInterval(timer);
      for (const track of stream.getTracks()) {
        track.stop();
      }
    },
  };
}

async function createLoopbackConnection(onStateChange: (state: RTCPeerConnectionState) => void) {
  const senderPeer = new RTCPeerConnection();
  const receiverPeer = new RTCPeerConnection();

  senderPeer.addEventListener('connectionstatechange', () => onStateChange(senderPeer.connectionState));
  receiverPeer.addEventListener('connectionstatechange', () => onStateChange(receiverPeer.connectionState));

  senderPeer.onicecandidate = (event) => {
    if (event.candidate) {
      void receiverPeer.addIceCandidate(event.candidate);
    }
  };
  receiverPeer.onicecandidate = (event) => {
    if (event.candidate) {
      void senderPeer.addIceCandidate(event.candidate);
    }
  };

  const canvasStream = createCanvasStream();
  const [videoTrack] = canvasStream.stream.getVideoTracks();
  if (!videoTrack) {
    throw new Error('Failed to create demo video track');
  }

  const onTrackPromise = new Promise<LoopbackHandle>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Timed out waiting for local loopback connection'));
    }, 8000);

    receiverPeer.ontrack = (event) => {
      clearTimeout(timeout);
      resolve({
        senderPeer,
        receiverPeer,
        stream: event.streams[0] ?? canvasStream.stream,
        stop: () => {
          canvasStream.stop();
          senderPeer.close();
          receiverPeer.close();
        },
      });
    };
  });

  senderPeer.addTrack(videoTrack, canvasStream.stream);
  receiverPeer.addTransceiver('video', { direction: 'recvonly' });

  const offer = await senderPeer.createOffer();
  await senderPeer.setLocalDescription(offer);
  await receiverPeer.setRemoteDescription(offer);

  const answer = await receiverPeer.createAnswer();
  await receiverPeer.setLocalDescription(answer);
  await senderPeer.setRemoteDescription(answer);

  return onTrackPromise;
}

export default function WebRtcDemoPage() {
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [broadcasterId, setBroadcasterId] = useState('browser-demo-broadcaster');
  const [sourceType, setSourceType] = useState('browser-demo');
  const [sourceLabel, setSourceLabel] = useState('local-loopback');
  const [runtimeLabel, setRuntimeLabel] = useState(
    typeof navigator === 'undefined' ? 'browser:unknown' : `browser:${navigator.userAgent}`,
  );
  const [sessionLabel, setSessionLabel] = useState('Browser Telemetry Demo');
  const [ingestorUrl, setIngestorUrl] = useState('http://localhost:4001');
  const [intervalMs, setIntervalMs] = useState(2000);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [captureActive, setCaptureActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastMetric, setLastMetric] = useState<{
    sourceRole: string;
    metricType: string;
    value: number;
    ts: number;
  } | null>(null);

  const broadcasterClientRef = useRef<SessionClient | null>(null);
  const viewerClientRef = useRef<SessionClient | null>(null);
  const loopbackRef = useRef<LoopbackHandle | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const browserSupportNote =
    typeof navigator === 'undefined'
      ? 'Browser support unknown outside browser runtime.'
      : /Chrome|Chromium|Edg\//.test(navigator.userAgent)
        ? 'Best effort support: Chromium-based browsers (recommended).'
        : /Firefox\//.test(navigator.userAgent)
          ? 'Partial support: Firefox may expose fewer stats fields.'
          : /Safari\//.test(navigator.userAgent)
            ? 'Partial support: Safari stats coverage is more limited.'
            : 'Support not guaranteed for this browser.';

  const stopDemo = () => {
    broadcasterClientRef.current?.stop();
    viewerClientRef.current?.stop();
    broadcasterClientRef.current = null;
    viewerClientRef.current = null;
    loopbackRef.current?.stop();
    loopbackRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setCaptureActive(false);
    setConnectionState('closed');
    setStatusMessage('Stopped');
    setLastMetric(null);
  };

  const startDemo = async () => {
    try {
      setErrorMessage(null);
      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('WebRTC is not supported in this browser/runtime.');
      }
      if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
        throw new Error('mediaDevices API is unavailable; use a modern Chromium browser for this demo.');
      }
      stopDemo();
      setConnectionState('connecting');
      setStatusMessage('Creating local loopback peer connection...');
      const loopback = await createLoopbackConnection(setConnectionState);
      loopbackRef.current = loopback;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = loopback.stream;
        void remoteVideoRef.current.play().catch(() => undefined);
      }

      const broadcasterClient = createSessionClient(loopback.senderPeer, {
        intervalMs,
        ingestorUrl,
        sessionId,
        broadcasterId,
        sourceType,
        sourceLabel: `${sourceLabel}:broadcaster`,
        runtimeLabel,
        sessionLabel,
        sourceRole: 'broadcaster',
        streamDirection: 'outbound',
        broadcasterRole: 'publisher',
        onError: (error) => {
          setErrorMessage(error instanceof Error ? error.message : 'Unknown SDK error');
        },
        onMetric: (metric) => {
          setLastMetric({
            sourceRole: metric.snapshot.sourceRole ?? 'broadcaster',
            metricType: metric.metricType,
            value: metric.value,
            ts: metric.ts,
          });
        },
      });
      const viewerClient = createSessionClient(loopback.receiverPeer, {
        intervalMs,
        ingestorUrl,
        sessionId,
        broadcasterId,
        sourceType,
        sourceLabel: `${sourceLabel}:viewer`,
        runtimeLabel,
        sessionLabel,
        sourceRole: 'viewer',
        streamDirection: 'inbound',
        broadcasterRole: 'viewer-monitor',
        onError: (error) => {
          setErrorMessage(error instanceof Error ? error.message : 'Unknown SDK error');
        },
        onMetric: (metric) => {
          setLastMetric({
            sourceRole: metric.snapshot.sourceRole ?? 'viewer',
            metricType: metric.metricType,
            value: metric.value,
            ts: metric.ts,
          });
        },
      });
      broadcasterClientRef.current = broadcasterClient;
      viewerClientRef.current = viewerClient;
      broadcasterClient.start();
      viewerClient.start();
      setCaptureActive(broadcasterClient.isActive() && viewerClient.isActive());
      setStatusMessage(
        'Loopback connected; broadcaster (outbound) and viewer (inbound) getStats telemetry are active.',
      );
    } catch (error) {
      stopDemo();
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start WebRTC demo');
    }
  };

  useEffect(() => () => stopDemo(), []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: 920 }}>
      <p>
        <Link href="/">← Back to dashboard</Link>
      </p>
      <h1>WebRTC Browser Telemetry Demo</h1>
      <p>
        Creates a local loopback RTCPeerConnection, polls <code>getStats()</code>, and sends canonical
        metrics to <code>/telemetry</code>. This page runs dual telemetry capture from the same loopback:
        broadcaster outbound + viewer inbound for clearer role/direction semantics.
      </p>
      <p>
        <strong>Browser compatibility:</strong> {browserSupportNote}
      </p>

      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 720 }}>
        <label>
          Session ID (UUID)
          <input
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Broadcaster ID
          <input
            value={broadcasterId}
            onChange={(event) => setBroadcasterId(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Source Type
          <input
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Source Label
          <input
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Runtime Label
          <input
            value={runtimeLabel}
            onChange={(event) => setRuntimeLabel(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Session Label
          <input
            value={sessionLabel}
            onChange={(event) => setSessionLabel(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Ingestor URL
          <input
            value={ingestorUrl}
            onChange={(event) => setIngestorUrl(event.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
        <label>
          Polling interval (ms)
          <input
            type="number"
            min={500}
            step={100}
            value={intervalMs}
            onChange={(event) => setIntervalMs(Number(event.target.value))}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          />
        </label>
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void startDemo()}>
          Start Loopback + Capture
        </button>
        <button type="button" onClick={stopDemo}>
          Stop
        </button>
        <button type="button" onClick={() => setSessionId(crypto.randomUUID())}>
          New Session ID
        </button>
        <Link href={`/sessions/${sessionId}`}>Open Session Timeline</Link>
      </div>

      <div style={{ marginTop: '1.25rem', padding: '0.9rem', border: '1px solid #ddd' }}>
        <p>
          <strong>Connection state:</strong> {connectionState}
        </p>
        <p>
          <strong>Stats capture active:</strong> {captureActive ? 'yes' : 'no'}
        </p>
        <p>
          <strong>Session ID:</strong> <code>{sessionId}</code>
        </p>
        <p>
          <strong>Status:</strong> {statusMessage}
        </p>
        <p>
          <strong>Source:</strong> {sourceType} ({sourceLabel})
        </p>
        <p>
          <strong>Runtime:</strong> {runtimeLabel}
        </p>
        <p>
          <strong>Role / Direction capture:</strong> broadcaster/outbound + viewer/inbound
        </p>
        <p>
          <strong>Session label:</strong> {sessionLabel}
        </p>
        <p>
          <strong>Latest metric:</strong>{' '}
          {lastMetric
            ? `[${lastMetric.sourceRole}] ${lastMetric.metricType}=${lastMetric.value} @ ${new Date(lastMetric.ts).toLocaleTimeString()}`
            : '—'}
        </p>
        {errorMessage ? (
          <p style={{ color: '#b91c1c' }}>
            <strong>Error:</strong> {errorMessage}
          </p>
        ) : null}
      </div>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Loopback Video</h2>
        <video
          ref={remoteVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', maxWidth: 640, border: '1px solid #ddd', borderRadius: 6 }}
        />
      </section>
    </main>
  );
}
