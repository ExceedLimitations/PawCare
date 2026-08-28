import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const IS_DEV = import.meta.env.DEV;

export function useSocket({ onStatus, onFeedingDone, onAlert, onFeedingsToday, onOtaStatus, onConnect, token }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  // Store all callbacks in refs so socket listeners always call the latest version
  // without needing to re-register (which would disconnect and reconnect the socket).
  const onStatusRef        = useRef(onStatus);
  const onFeedingDoneRef   = useRef(onFeedingDone);
  const onAlertRef         = useRef(onAlert);
  const onFeedingsTodayRef = useRef(onFeedingsToday);
  const onOtaStatusRef     = useRef(onOtaStatus);
  const onConnectRef       = useRef(onConnect);

  // Keep refs in sync with latest props every render
  onStatusRef.current        = onStatus;
  onFeedingDoneRef.current   = onFeedingDone;
  onAlertRef.current         = onAlert;
  onFeedingsTodayRef.current = onFeedingsToday;
  onOtaStatusRef.current     = onOtaStatus;
  onConnectRef.current       = onConnect;

  useEffect(() => {
    if (!token) {
      // No auth token — don't open a connection that the server will immediately reject.
      // Socket.io would retry indefinitely, flooding the server with failed handshakes.
      socketRef.current = null;
      setConnected(false);
      return;
    }
    const socket = io(IS_DEV ? 'http://localhost:3000' : '/', {
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect',       () => { setConnected(true); onConnectRef.current?.(); });
    socket.on('disconnect',    () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Delegate to refs so the latest callback is always called
    socket.on('status',        (d) => onStatusRef.current?.(d));
    socket.on('feeding_done',  (d) => onFeedingDoneRef.current?.(d));
    socket.on('alert',         (d) => onAlertRef.current?.(d));
    socket.on('feedings_today',(d) => onFeedingsTodayRef.current?.(d));
    socket.on('ota_status',    (d) => onOtaStatusRef.current?.(d));

    return () => socket.disconnect();
  }, [token]); // Only reconnect when token changes

  const emit = (event, data) => socketRef.current?.emit(event, data);
  return { connected, emit };
}
