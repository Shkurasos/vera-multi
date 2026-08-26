/*
 * CallTile — один участник (аватар/видео + рамка при speaking + иконки mic/cam).
 */
import React, { useEffect, useRef } from 'react';
import { Box, Avatar, Typography } from '@mui/material';
import { MicOff, VideocamOff, VolumeOff } from '@mui/icons-material';
import type { CallPeer } from '../store/callStore';

interface Props {
  peer?: CallPeer;
  isLocal?: boolean;
  displayName: string;
  avatarUrl?: string;
  stream?: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  deaf: boolean;
  speaking: boolean;
  size?: 'grid' | 'mini';
}

export default function CallTile({
  displayName, avatarUrl, stream, camOn, micOn, deaf, speaking, isLocal, size = 'grid',
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const border = speaking ? '3px solid #22c55e' : '3px solid transparent';
  const bg = 'linear-gradient(135deg, #2b2d31 0%, #1e1f22 100%)';

  if (size === 'mini') {
    return (
      <Box sx={{
        width: 32, height: 32, borderRadius: '50%',
        border: speaking ? '2px solid #22c55e' : '2px solid #2b2d31',
        overflow: 'hidden', position: 'relative', flexShrink: 0,
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Avatar sx={{ width: '100%', height: '100%', fontSize: 14 }}>{displayName[0]?.toUpperCase()}</Avatar>}
      </Box>
    );
  }

  return (
    <Box sx={{
      position: 'relative', borderRadius: 2, overflow: 'hidden',
      background: bg, border, transition: 'border-color .15s',
      aspectRatio: '16 / 10', minHeight: 160,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {camOn && stream ? (
        <video
          ref={videoRef} autoPlay playsInline muted={isLocal}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Avatar
          src={avatarUrl}
          sx={{
            width: 96, height: 96, fontSize: 40,
            boxShadow: speaking ? '0 0 0 4px rgba(34,197,94,0.35)' : 'none',
            transition: 'box-shadow .15s',
          }}
        >
          {displayName[0]?.toUpperCase()}
        </Avatar>
      )}

      <Box sx={{
        position: 'absolute', left: 8, bottom: 8, right: 8,
        display: 'flex', alignItems: 'center', gap: 0.75,
        color: '#fff',
      }}>
        <Typography sx={{
          fontSize: 13, fontWeight: 600,
          bgcolor: 'rgba(0,0,0,0.55)', px: 1, py: 0.25, borderRadius: 1,
          maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {displayName}{isLocal ? ' (вы)' : ''}
        </Typography>
        {!micOn && (
          <Box sx={{ bgcolor: 'rgba(239,68,68,0.9)', borderRadius: 1, p: 0.25, display: 'flex' }}>
            <MicOff sx={{ fontSize: 14 }} />
          </Box>
        )}
        {!camOn && (
          <Box sx={{ bgcolor: 'rgba(0,0,0,0.55)', borderRadius: 1, p: 0.25, display: 'flex' }}>
            <VideocamOff sx={{ fontSize: 14 }} />
          </Box>
        )}
        {deaf && (
          <Box sx={{ bgcolor: 'rgba(239,68,68,0.9)', borderRadius: 1, p: 0.25, display: 'flex' }}>
            <VolumeOff sx={{ fontSize: 14 }} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
