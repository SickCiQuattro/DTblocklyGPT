import React, { useState } from 'react';
import { Popover, Box, Typography, Stack, Button } from '@mui/material';

interface ConfirmPopoverProps {
  title: string;
  onConfirm: () => void;
  cancelText?: string;
  confirmText?: string;
  children: (onOpen: (event: React.MouseEvent<HTMLElement>) => void) => React.ReactNode;
}

export const ConfirmPopover: React.FC<ConfirmPopoverProps> = ({
  title,
  onConfirm,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  children,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleConfirm = () => {
    onConfirm();
    handleClose();
  };

  return (
    <>
      {children(handleOpen)}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
            }
          }
        }}
      >
        <Box sx={{ p: 2, maxWidth: 220 }}>
          <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 500 }}>
            {title}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button size="small" variant="text" onClick={handleClose}>
              {cancelText}
            </Button>
            <Button size="small" variant="contained" color="error" onClick={handleConfirm}>
              {confirmText}
            </Button>
          </Stack>
        </Box>
      </Popover>
    </>
  );
};
