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
  const [sourceRole, setSourceRole] = useState<'broadcaster' | 'viewer' | 'browser-demo' | 'simulator'>(
    'browser-demo',
  );
  const [streamDirection, setStreamDirection] = useState<'outbound' | 'inbound' | 'bidirectional'>(
    'bidirectional',
  );
  const [ingestorUrl, setIngestorUrl] = useState('http://localhost:4001');
  const [intervalMs, setIntervalMs] = useState(2000);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [captureActive, setCaptureActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastMetric, setLastMetric] = useState<{
    metricType: string;
    value: number;
    ts: number;
  } | null>(null);

  const clientRef = useRef<SessionClient | null>(null);
  const loopbackRef = useRef<LoopbackHandle | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const stopDemo = () => {
    clientRef.current?.stop();
    clientRef.current = null;
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

      const client = createSessionClient(loopback.senderPeer, {
        intervalMs,
        ingestorUrl,
        sessionId,
        broadcasterId,
        sourceType,
        sourceLabel,
        runtimeLabel,
        sessionLabel,
        sourceRole,
        streamDirection,
        onError: (error) => {
          setErrorMessage(error instanceof Error ? error.message : 'Unknown SDK error');
        },
        onMetric: (metric) => {
          setLastMetric({
            metricType: metric.metricType,
            value: metric.value,
            ts: metric.ts,
          });
        },
      });
      clientRef.current = client;
      client.start();
      setCaptureActive(client.isActive());
      setStatusMessage('Loopback connected; getStats telemetry polling is active.');
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
        metrics to <code>/telemetry</code>. Includes source/runtime/role/direction labels for easier
        debugging. This MVP path is primarily validated on Chromium-based browsers.
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
          Source Role
          <select
            value={sourceRole}
            onChange={(event) => setSourceRole(event.target.value as typeof sourceRole)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          >
            <option value="browser-demo">browser-demo</option>
            <option value="broadcaster">broadcaster</option>
            <option value="viewer">viewer</option>
            <option value="simulator">simulator</option>
          </select>
        </label>
        <label>
          Stream Direction
          <select
            value={streamDirection}
            onChange={(event) => setStreamDirection(event.target.value as typeof streamDirection)}
            style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
          >
            <option value="bidirectional">bidirectional</option>
            <option value="outbound">outbound</option>
            <option value="inbound">inbound</option>
          </select>
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
          <strong>Role / Direction:</strong> {sourceRole} / {streamDirection}
        </p>
        <p>
          <strong>Session label:</strong> {sessionLabel}
        </p>
        <p>
          <strong>Latest metric:</strong>{' '}
          {lastMetric
            ? `${lastMetric.metricType}=${lastMetric.value} @ ${new Date(lastMetric.ts).toLocaleTimeString()}`
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
