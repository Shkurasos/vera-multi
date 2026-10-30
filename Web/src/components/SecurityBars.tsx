import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { User } from '../types';

interface SecurityBarsProps {
  user: User | null;
  theme: any;
}

/**
 * Три маленьких полоски безопасности в углу профиля.
 * Горят зелёным, если выполнено условие:
 * 1 — телефон привязан, 2 — почта привязана, 3 — нет предупреждений от админов.
 */
export default function SecurityBars({ user, theme }: SecurityBarsProps) {
  const checks = [
    { active: Boolean(user?.phone), label: 'Телефон привязан' },
    { active: Boolean(user?.email), label: 'Почта привязана' },
    { active: (user?.adminWarnings ?? 0) === 0, label: 'Нет предупреждений от администрации' },
  ];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 10,
      }}
    >
      {checks.map((check, i) => (
        <Tooltip key={i} title={check.label} arrow placement="bottom">
          <Box
            sx={{
              width: 5,
              height: 18,
              borderRadius: 1,
              bgcolor: check.active ? '#4caf50' : `${theme.textSec}22`,
              border: `1px solid ${check.active ? '#4caf50' : theme.border}`,
              boxShadow: check.active ? '0 0 8px rgba(76, 175, 80, 0.55)' : undefined,
              transition: 'all 0.3s ease',
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
