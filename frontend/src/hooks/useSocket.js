import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const IS_DEV = import.meta.env.DEV;

export function useSocket({ onStatus, onFeedingDone, onAlert, onFeedingsToday, token }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(IS_DEV ? 'http://localhost:3000' : '/', {
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('status', onStatus);
    socket.on('feeding_done', onFeedingDone);
    socket.on('alert', onAlert);
    socket.on('feedings_today', onFeedingsToday);

    return () => socket.disconnect();
  }, [token]);

  const emit = (event, data) => socketRef.current?.emit(event, data);
  return { connected, emit };
}
