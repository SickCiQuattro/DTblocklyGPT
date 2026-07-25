import React, { useState } from 'react'
import { Box, Stack, Typography, IconButton } from '@mui/material'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface TreeNode {
  key: string
  title: string
  icon?: React.ReactNode
  children?: TreeNode[]
}

interface StepTreeNodeProps {
  node: TreeNode
  depth?: number
}

const StepTreeNode: React.FC<StepTreeNodeProps> = ({ node, depth = 0 }) => {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children && node.children.length > 0

  return (
    // Tighter than a generic file-tree gutter on purpose: most proposals here
    // are short flat lists with zero nesting, so the chevron-or-spacer column
    // that every row reserves (even leaf rows with nothing to expand) was
    // eating real width in a ~320-600px chat panel for no reason.
    <Box sx={{ pl: depth * 1.5 }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ py: 0.5, alignItems: 'center' }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            sx={{ p: 0.25, color: 'text.secondary' }}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 18 }} />
        )}
        {node.icon && (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>{node.icon}</Box>
        )}
        <Typography
          variant="body2"
          sx={{ color: 'text.primary', fontWeight: 500 }}
        >
          {node.title}
        </Typography>
      </Stack>
      {hasChildren && open && (
        <Box sx={{ borderLeft: '1px solid', borderColor: 'divider', ml: 1 }}>
          {node.children!.map((child) => (
            <StepTreeNode key={child.key} node={child} depth={depth + 1} />
          ))}
        </Box>
      )}
    </Box>
  )
}

export const StepTree: React.FC<{ treeData: TreeNode[] }> = ({ treeData }) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {treeData.map((node) => (
        <StepTreeNode key={node.key} node={node} />
      ))}
    </Box>
  )
}
