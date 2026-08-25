import React from 'react';
import { Box, Typography } from '@mui/material';
import { useChatStore } from '../store/chatStore';
import { useNavigate } from 'react-router-dom';

export default function WelcomeScreen() {
  const { chats, setActiveChat } = useChatStore();
  const navigate = useNavigate();

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: '#1E1E2E',
      gap: 1.5,
    }}>
      {/* Иконка */}
      <Box sx={{
        width: 72, height: 72, borderRadius: '50%',
        bgcolor: '#2E2E3E',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        mb: 1,
      }}>
        <Typography sx={{ fontSize: 36 }}>💬</Typography>
      </Box>

      <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#C0C0D8' }}>
        Vera
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#5A5A7A', textAlign: 'center', maxWidth: 280 }}>
        Выберите чат, чтобы начать общение
      </Typography>

      {/* Быстрый доступ к чатам */}
      {chats.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%', maxWidth: 260 }}>
          {chats.slice(0, 3).map((chat) => (
            <Box
              key={chat.id}
              onClick={() => { setActiveChat(chat); navigate(`/chat/${chat.id}`); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                px: 2, py: 1, borderRadius: 2,
                bgcolor: '#252535', cursor: 'pointer',
                '&:hover': { bgcolor: '#2E2E3E' },
              }}
            >
              <Box sx={{
                width: 32, height: 32, borderRadius: '50%',
                bgcolor: '#3A3A52',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: '#C0C0D8', fontWeight: 600, flexShrink: 0,
              }}>
                {(chat.name || '?')[0].toUpperCase()}
              </Box>
              <Typography sx={{ fontSize: 13, color: '#C0C0D8' }} noWrap>
                {chat.name || 'Чат'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
