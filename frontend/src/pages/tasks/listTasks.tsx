import React, { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'react-toastify'
import { alpha, useTheme } from '@mui/material/styles'
import {
  Box,
  Button,
  IconButton,
  OutlinedInput,
  InputAdornment,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material'
import {
  Eye,
  Play,
  BrainCircuit,
  Plus,
  Search,
  Trash2,
  Share2,
  Lock,
  Users,
  ListChecks,
  MoreVertical,
  Undo2,
  AlertTriangle,
  Bot,
} from 'lucide-react'

import { MainCard } from 'components/MainCard'
import { ConfirmDialog } from 'components/ConfirmDialog'
import { TaskStatusChip } from 'components/TaskStatusChip'
import { SegmentedControl } from 'components/SegmentedControl'
import { KeycapHint, modKey } from 'components/KeycapHint'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { formatDateTimeShortFrontend, formatRelativeFrontend } from 'utils/date'
import { isModalOpen } from 'utils/keyboardGuards'
import { getFromLocalStorage, LocalStorageKey } from 'utils/localStorageUtils'
import { MyRobotType } from 'pages/myrobots/types'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { UserLoginInterface } from 'pages/login/LoginForm'
import { Theme as ThemeOption } from 'themes/theme'
import { useDocumentTitle } from 'hooks/useDocumentTitle'
import { UI_TEXT } from 'constants/uiVocabulary'

import { TaskType } from './types'
import { AnalyzeTaskModal } from './analyzeTaskModal'

// Menu/status icon colors sourced once from the design-system tokens (these
// render inside several sub-components without direct theme access).
/** The compact per-task summary the list endpoint now ships (backend/utils/
 * task_summary.py). Optional: an older server, or a task saved before the
 * field existed, simply renders no strip rather than an empty one. */
interface TaskUses {
  steps: number
  movesRobot: boolean
  needsCamera: boolean
  needsVoice: boolean
  usesSavedTask: boolean
}

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 2,
} as const

const SCROLL_AREA_SX = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  // Not `auto`: a horizontal bar here would only ever mean the grid
  // mis-measured itself, and auto-fill columns cannot legitimately overflow
  // sideways.
  overflowX: 'hidden',
  p: 2,
  m: -2,
} as const

const tokenPalette = ThemeOption()

type StatusFilter = 'all' | 'draft' | 'published'

// A task is "published" for filtering purposes whenever it has a live
// version — published_with_draft still has one, just with edits pending.
const matchesStatusFilter = (
  status: string | undefined,
  filter: StatusFilter,
) => {
  if (filter === 'all') return true
  const s = status?.toLowerCase()
  if (filter === 'published')
    return s === 'published' || s === 'published_with_draft'
  return s === 'draft'
}

// ─── Task Row Actions Overflow Menu ──────────────────────────────────────────

const TaskRowActions = ({
  row,
  canManage,
  handleOpenDetails,
  setAnalyzeModalVisible,
  setAnalyzingTask,
  handleDelete,
  handleDiscard,
  referenceDataError,
  simulatorDown,
}: {
  row: TaskType
  canManage: boolean
  handleOpenDetails: (id: number) => void
  setAnalyzeModalVisible: (v: boolean) => void
  setAnalyzingTask: (t: TaskType) => void
  handleDelete: (id: number) => Promise<unknown>
  handleDiscard: (id: number) => Promise<unknown>
  referenceDataError: boolean
  simulatorDown: boolean
}) => {
  const navigate = useNavigate()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const open = Boolean(anchorEl)
  const rowStatus = (row as any).status?.toLowerCase()
  const isPublishedWithDraft = rowStatus === 'published_with_draft'
  // Only a fully published task can run — published_with_draft can't either:
  // the runtime uses published_workspace, which would no longer match the
  // draft shown in the editor (same gate as DigitalTwinPanel.tsx's canRun).
  const canRun = rowStatus === 'published'

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    setAnchorEl(event.currentTarget)
  }
  const handleClose = () => {
    setAnchorEl(null)
  }

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center' }}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip
        title={
          canRun
            ? simulatorDown
              ? // Said here as well as in the banner, because this is where
                // the operator's hand is. The button stays enabled on purpose:
                // that health check is fetched on arrival and on tab focus,
                // never polled — it is orientation, not a monitor — and
                // disabling a control on state nobody is watching is how you
                // block work that would have succeeded. The panel checks
                // properly before it runs anything.
                `${UI_TEXT.simulate} this task — the simulator was not responding when this page loaded`
              : `${UI_TEXT.simulate} this task`
            : isPublishedWithDraft
              ? `${UI_TEXT.unpublishedChanges} — publish or discard them to run this task`
              : 'This task is a draft — publish it first to run it'
        }
      >
        {/* span wrapper: a disabled IconButton alone won't fire the
            Tooltip's hover events */}
        <span>
          <Button
            // Labelled, and heavier than the overflow menu beside it.
            //
            // This was a 17px ghost icon sitting at the same visual weight as
            // the "…" next to it, on the page whose whole job is running
            // tasks: the action performed ten times a day was quieter than the
            // one performed once, and quieter than "New task" at the top. It
            // has always carried a tooltip and an aria-label, so this is a
            // hierarchy problem rather than an accessibility one — the fix is
            // weight and a word, not a label that only some users get.
            //
            // Always green, always opens the panel pre-set to Simulate (never
            // Real robot): a one-click shortcut from a list must not default to
            // moving the physical arm. Matches the robot panel's "green =
            // twin-only" convention (DigitalTwinPanel.tsx).
            variant="outlined"
            size="small"
            color="success"
            startIcon={<Play size={15} />}
            sx={{ textTransform: 'none', fontWeight: 600, minHeight: 34 }}
            disabled={!canRun}
            onClick={() =>
              navigate(`/task/${row.id}`, {
                state: { autoOpenRobot: true, executionTarget: 'sim' },
              })
            }
            id={`btn-run-task-${row.id}`}
          >
            {UI_TEXT.simulate}
          </Button>
        </span>
      </Tooltip>

      <Tooltip title="More actions">
        <IconButton
          sx={{ width: 40, height: 40 }}
          onClick={handleClick}
          aria-label="more actions"
        >
          <MoreVertical size={18} />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { minWidth: '150px' } } }}
      >
        <MenuItem
          onClick={() => {
            handleClose()
            handleOpenDetails(row.id)
          }}
          disabled={!canManage}
          title={
            canManage
              ? undefined
              : "Shared by another user — you can't edit this task"
          }
        >
          <ListItemIcon>
            <Eye size={15} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>Edit details</Typography>
            }
          />
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleClose()
            if (referenceDataError) {
              toast.error(
                "Couldn't load objects/locations/skills/robots — check for problems needs them and your connection dropped. Try again.",
              )
              return
            }
            setAnalyzeModalVisible(true)
            setAnalyzingTask(row)
          }}
        >
          <ListItemIcon>
            <BrainCircuit size={15} style={{ color: tokenPalette.info.dark }} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem' }}>
                Check for problems
              </Typography>
            }
          />
        </MenuItem>

        {isPublishedWithDraft && (
          <MenuItem
            onClick={(e) => {
              if (!canManage) return
              e.stopPropagation()
              setDiscardConfirmOpen(true)
            }}
            disabled={!canManage}
            title={
              canManage
                ? undefined
                : "Shared by another user — you can't manage this task"
            }
          >
            <ListItemIcon>
              <Undo2 size={15} style={{ color: tokenPalette.warning.dark }} />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography sx={{ fontSize: '0.85rem' }}>
                  {UI_TEXT.discardUnpublishedChanges}
                </Typography>
              }
            />
          </MenuItem>
        )}

        <Divider />

        {/* The one path from this list to the physical arm.
            There was none: this menu held Edit details, Discard unpublished
            changes, Check for problems and Delete, so running a task on the
            robot meant opening it, pressing Run, and switching the panel's
            target by hand — four steps for what Simulate does in one.

            A menu row rather than a modifier on the Simulate button. Cmd+click
            already means "open in a new tab" in every browser, and this button
            sits inside a card that itself navigates, so that gesture would arm
            the arm for someone reaching for a new tab. A modifier is also the
            least discoverable affordance there is, which is the wrong property
            for the action that moves metal. Same hierarchy argument that gave
            Simulate its label: the frequent action gets one click, the rare
            one gets two — and this one gets a name.

            Opening the panel on "Real robot" does not move anything by itself:
            the panel confirms a real run, and motion still needs both
            DRIVE_HARDWARE server-side and driveHardware per request. */}
        <MenuItem
          disabled={!canRun}
          onClick={(e) => {
            e.stopPropagation()
            handleClose()
            navigate(`/task/${row.id}`, {
              state: { autoOpenRobot: true, executionTarget: 'real' },
            })
          }}
          title={
            canRun
              ? undefined
              : 'Only a published task can run — publish it first'
          }
        >
          <ListItemIcon>
            <Bot size={15} color={tokenPalette.warning.darker} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem', color: 'warning.darker' }}>
                {UI_TEXT.runOnRobot}
              </Typography>
            }
          />
        </MenuItem>

        <MenuItem
          onClick={(e) => {
            if (!canManage) return
            e.stopPropagation()
            setDeleteConfirmOpen(true)
          }}
          disabled={!canManage}
          sx={{ color: 'error.dark' }}
          title={
            canManage
              ? undefined
              : "Shared by another user — you can't delete this task"
          }
        >
          <ListItemIcon>
            <Trash2 size={15} color={tokenPalette.error.dark} />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography sx={{ fontSize: '0.85rem', color: 'error.dark' }}>
                Delete
              </Typography>
            }
          />
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={deleteConfirmOpen}
        loading={isDeleting}
        message="Delete this task? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          setIsDeleting(true)
          // fetchApi (services/api.ts) already toasts on failure and rethrows —
          // .catch() here just absorbs that rejection so it doesn't surface as
          // an unhandled promise rejection; no second toast added.
          void handleDelete(row.id)
            .catch(() => {})
            .finally(() => {
              setIsDeleting(false)
              setDeleteConfirmOpen(false)
              handleClose()
            })
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={discardConfirmOpen}
        loading={isDiscarding}
        title={`${UI_TEXT.discardUnpublishedChanges}?`}
        message="They'll be lost and the task will revert to its last published version."
        confirmLabel="Discard"
        onConfirm={() => {
          setIsDiscarding(true)
          void handleDiscard(row.id)
            .catch(() => {})
            .finally(() => {
              setIsDiscarding(false)
              setDiscardConfirmOpen(false)
              handleClose()
            })
        }}
        onCancel={() => setDiscardConfirmOpen(false)}
      />
    </Stack>
  )
}

// ─── Task card ────────────────────────────────────────────────────────────────

/**
 * The card's description, clamped to two lines with the rest on hover.
 *
 * It was one line with an ellipsis and no tooltip, so a description longer
 * than the card was simply unreadable without opening Edit details on another
 * page. The seeded catalogue runs 38–132 characters against roughly 250px of
 * card, so most of it was cut and a second line carries most of it whole.
 *
 * The tooltip appears only when the text is ACTUALLY clamped, measured rather
 * than assumed — this is the grid an operator sweeps the pointer across to
 * click a card, and a tooltip that repeats a sentence already fully on screen
 * is worse than the truncation it was added to explain.
 */
const TaskDescription = ({ text }: { text: string }) => {
  const ref = useRef<HTMLElement | null>(null)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // +1 absorbs sub-pixel line heights, which otherwise report a one-pixel
    // overflow on text that fits and make every card show a tooltip.
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    // Card width follows the grid, which follows the viewport: a sentence that
    // fits on two lines at 1440px is cut at 1024px, and nothing re-renders in
    // between.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  return (
    <Tooltip title={clamped ? text : ''}>
      <Typography
        ref={ref}
        variant="caption"
        color="text.secondary"
        sx={{
          // -webkit-box + line-clamp, not `nowrap` + text-overflow: the second
          // can only ever cut at one line. The clamp draws its own ellipsis.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {text}
      </Typography>
    </Tooltip>
  )
}

const TaskCard = ({
  row,
  canView,
  canManage,
  onOpen,
  ...actionProps
}: {
  row: TaskType
  canView: boolean
  canManage: boolean
  onOpen: () => void
} & Omit<React.ComponentProps<typeof TaskRowActions>, 'row' | 'canManage'>) => (
  <Tooltip
    title={canView ? '' : 'Private — owned by another user'}
    disableHoverListener={canView}
  >
    <Paper
      variant="outlined"
      tabIndex={canView ? 0 : -1}
      role="button"
      aria-label={
        canView
          ? row.shared && !canManage
            ? `Open ${row.name} workspace — shared, read only`
            : `Open ${row.name} workspace`
          : `${row.name} — private, owned by another user`
      }
      onClick={() => canView && onOpen()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && canView) {
          e.preventDefault()
          onOpen()
        }
      }}
      sx={{
        p: 2,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        cursor: canView ? 'pointer' : 'default',
        opacity: canView ? 1 : 0.72,
        boxShadow: (theme) => theme.customShadows.card,
        '@media (prefers-reduced-motion: no-preference)': {
          // Keep the card on its own compositing layer at rest too — without
          // this, the hover-only `transform` promotes it to a layer only on
          // hover, and Chromium re-rasterizes the outlined border with
          // different anti-aliasing, making the (already-present) top border
          // suddenly look like a new line popping in.
          willChange: 'transform',
          transition: 'transform 0.2s ease',
          '&:hover': { transform: 'translateY(-2px)' },
        },
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: '0.9rem',
              color: 'text.primary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </Typography>
          {row.description && <TaskDescription text={row.description} />}
        </Box>
        {/* Was a bordered, tinted pill with icon AND label — the loudest thing
            on the card after the name, for a binary that is nearly always the
            same value and that an operator almost never acts on. Demoted to a
            bare icon: still present, still explained on hover, no longer
            competing with what the program actually does.

            Only on a task you own. `shared` is the owner's choice about who
            may see it, and on someone else's task that is not a fact about
            you: the only reason it is in your list at all is that it IS
            shared, so the icon would be a constant. What matters there is who
            owns it, and that goes in the meta row below as words. */}
        {canManage && (
          <Tooltip title={row.shared ? 'Shared with other users' : 'Private'}>
            <Box sx={{ flexShrink: 0, display: 'flex', pt: 0.25 }}>
              {row.shared ? (
                <Share2 size={14} color={tokenPalette.slate[400]} />
              ) : (
                <Lock size={14} color={tokenPalette.slate[300]} />
              )}
            </Box>
          </Tooltip>
        )}
      </Stack>

      <UsesStrip uses={(row as any).uses} />

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <TaskStatusChip status={(row as any).status} />
        <Typography variant="caption" color="text.secondary">
          {/* Relative, with the exact value on hover — the grid is sorted by
              this field, and the ordering has to be visible without parsing
              DD/MM twice. */}
          <Tooltip title={formatDateTimeShortFrontend(row.last_modified) ?? ''}>
            <span>{formatRelativeFrontend(row.last_modified)}</span>
          </Tooltip>
        </Typography>
        {/* Whose task this is, in words, on the card.

            The app already knew — `owner__username` is in the list payload and
            has been all along, and the workspace header says "Shared by X —
            read-only" the moment you open one. The card said nothing, so the
            only way to find out that a task is not yours was to open it, and
            what you found there was that you could not edit it. Same sentence
            as the header, deliberately: two screens describing one fact should
            not need to be reconciled.

            Visible rather than a hover, unlike the private/shared icon above.
            That icon is a binary that is nearly always the same and that the
            operator rarely acts on; this is rarely true and it changes what
            the card can do — Edit, Discard and Delete are already absent from
            its menu, and an absence explains nothing. */}
        {!canManage && (
          <Tooltip
            title={`Shared by ${row.owner__username || 'another user'} — you can open and run this task, but not edit it`}
          >
            <Stack
              direction="row"
              spacing={0.5}
              sx={{
                alignItems: 'center',
                color: 'text.secondary',
                minWidth: 0,
              }}
            >
              <Users size={12} style={{ flexShrink: 0 }} />
              <Typography
                variant="caption"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Shared by {row.owner__username || 'another user'}
              </Typography>
            </Stack>
          </Tooltip>
        )}
      </Stack>

      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          mt: 'auto',
          pt: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TaskRowActions row={row} canManage={canManage} {...actionProps} />
      </Stack>
    </Paper>
  </Tooltip>
)

/**
 * What this program touches, in one mono row.
 *
 * The signature element of this page, and the reason it is here rather than a
 * decorative flourish: an operator standing next to the arm is choosing what to
 * open, and the fact that decides whether they clear the bench first — does
 * this one move the robot — was previously visible only after opening it. The
 * list already showed name, status and date; it showed nothing about
 * consequence.
 *
 * Amber is not a highlight colour here. It carries the meaning the robot panel
 * already gave it — "this reaches the physical arm" — so the same colour means
 * the same thing on the card, in the run button, and in the live-hardware
 * banner. Everything else stays slate: one loud thing per card, and it is the
 * one with a physical consequence.
 *
 * Geist Mono, matching the robot panel's STATUS readout. It is what makes the
 * home page read as a control surface rather than a list of documents.
 */
const UsesStrip = ({ uses }: { uses?: TaskUses }) => {
  const theme = useTheme()
  if (!uses) return null

  const items: { key: string; label: string; amber?: boolean }[] = [
    {
      key: 'steps',
      label: `${uses.steps} ${uses.steps === 1 ? 'step' : 'steps'}`,
    },
  ]
  // The INFORMATIVE case is the absence.
  //
  // "moves arm" was pushed for every task that moves the arm, which is very
  // nearly all of them — nine of nine on the first screen. A tag carried by
  // everything separates nothing and costs a line on every card, while
  // "camera" and "voice" earn theirs by being rare.
  //
  // What is worth marking is the task that does NOT move the arm: messages and
  // waits only, the human-in-the-loop case this system exists for. That one had
  // no tag at all, so the one card worth a second look was the one with the
  // least ink on it.
  if (!uses.movesRobot)
    items.push({ key: 'arm', label: 'no arm movement', amber: true })
  if (uses.needsCamera) items.push({ key: 'cam', label: 'camera' })
  if (uses.needsVoice) items.push({ key: 'mic', label: 'voice' })
  if (uses.usesSavedTask) items.push({ key: 'macro', label: 'saved task' })

  return (
    <Stack
      direction="row"
      sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', rowGap: 0.5 }}
    >
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {i > 0 && (
            <Box
              aria-hidden
              sx={{
                width: 3,
                height: 3,
                borderRadius: '50%',
                bgcolor: 'divider',
                flexShrink: 0,
              }}
            />
          )}
          <Typography
            component="span"
            sx={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: '0.68rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: item.amber
                ? theme.palette.warning.darker
                : tokenPalette.slate[500],
            }}
          >
            {item.label}
          </Typography>
        </React.Fragment>
      ))}
    </Stack>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

const ListTasks = () => {
  useDocumentTitle('Tasks')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ⌘K/Ctrl+K jumps to the search field, mirroring the same shortcut inside
  // the task workspace (BlocklyEditor.tsx) — ignored while typing in another
  // field so it can't hijack normal text entry (e.g. a modal's own inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')))
        return
      // The typing check below isn't enough while a dialog is open ("Check for
      // problems", a row's delete/discard confirm): those focus a button, not
      // an input, so the guard passed and this pulled focus to a search field
      // outside the dialog — straight through MUI's focus trap, which then
      // fights to pull it back.
      if (isModalOpen()) return
      const active = document.activeElement
      const isTypingElsewhere =
        active instanceof HTMLElement &&
        active !== searchInputRef.current &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      if (isTypingElsewhere) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const {
    data: dataTasks,
    error: tasksError,
    mutate,
    isLoading: isLoadingTasks,
  } = useSWR<TaskType[], Error>(
    { url: endpoints.home.libraries.tasks },
    { revalidateOnFocus: true, revalidateOnMount: true },
  )

  const { data: dataMyRobots, error: myRobotsError } = useSWR<
    MyRobotType[],
    Error
  >({
    url: endpoints.home.libraries.myRobots,
  })
  const { data: dataObjects, error: objectsError } = useSWR<
    ObjectListType[],
    Error
  >({
    url: endpoints.home.libraries.objects,
  })
  const { data: dataLocations, error: locationsError } = useSWR<
    LocationListType[],
    Error
  >({
    url: endpoints.home.libraries.locations,
  })
  const { data: dataActions, error: actionsError } = useSWR<
    ActionListType[],
    Error
  >({
    url: endpoints.home.libraries.actions,
  })
  // "Check for problems" needs all four of these to give a meaningful
  // result — silently opening it with some dropdowns empty (previously
  // unhandled errors here) looks like a bug, not a connectivity issue.
  const referenceDataError = !!(
    myRobotsError ||
    objectsError ||
    locationsError ||
    actionsError
  )

  const [analyzeModalVisible, setAnalyzeModalVisible] = useState(false)
  const [analyzingTask, setAnalyzingTask] = useState<TaskType | null>(null)

  const storedUser: unknown = getFromLocalStorage(LocalStorageKey.USER)
  const currentUserId =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'id' in storedUser &&
    (typeof storedUser.id === 'string' || typeof storedUser.id === 'number')
      ? String(storedUser.id)
      : null

  const canManage = (owner: TaskType['owner']) =>
    currentUserId !== null && String(owner) === currentUserId

  // Opening a shared task is legitimate (task_detail's GET already allows
  // owner-or-shared reads, and the workspace itself now renders a read-only
  // mode for it) — canManage alone used to block the card entirely for any
  // shared-not-owned task, while the separate Run icon (status-only, no
  // ownership check) opened it anyway. canView is the real "can this row be
  // opened at all" gate; canManage stays owner-only for Edit/Discard/Delete.
  const canView = (row: TaskType) => canManage(row.owner) || row.shared

  const handleOpenWorkspace = (id: number) => {
    dispatch(activeItem(''))
    navigate(`/task/${id}`)
  }

  const handleOpenDetails = (id: number) => {
    dispatch(activeItem('tasks'))
    navigate(`/task/${id}/details`)
  }

  const handleDelete = (id: number) => {
    return fetchApi({
      url: endpoints.home.libraries.task,
      method: MethodHTTP.DELETE,
      body: { id },
    }).then(() => {
      toast.success(MessageText.success)
      mutate()
    })
  }

  const handleDiscard = (id: number) => {
    // No .then-chained .catch here: fetchApi already toasts every failure
    // path (services/api.ts) and rethrows — the call sites below absorb that
    // rejection instead, so it doesn't surface as unhandled without a second
    // redundant toast.
    return fetchApi({
      url: endpoints.task.discardDraft,
      method: MethodHTTP.POST,
      body: { id },
    }).then(() => {
      toast.success('Unpublished changes discarded')
      mutate()
    })
  }

  const handleAdd = () => {
    navigate('/task/new')
  }

  const rows = dataTasks ?? []
  const filteredRows = rows.filter((row) => {
    const matchesSearch =
      !search || row.name.toLowerCase().includes(search.toLowerCase())
    return (
      matchesSearch && matchesStatusFilter((row as any).status, statusFilter)
    )
  })
  const isFiltering = search.trim() !== '' || statusFilter !== 'all'
  const draftCount = rows.filter((r) =>
    matchesStatusFilter((r as any).status, 'draft'),
  ).length
  const publishedCount = rows.filter((r) =>
    matchesStatusFilter((r as any).status, 'published'),
  ).length
  // Not publishedCount. That one deliberately includes published_with_draft —
  // correct for the filter chip, whose question is "has a live version" — and
  // it was also being printed as "ready to run", whose question is `canRun`,
  // strictly 'published'. So a task with unpublished changes was counted as
  // ready while its own Simulate button sat disabled next to the tooltip
  // "publish or discard them to run this task".
  const runnableCount = rows.filter(
    (r) => (r as any).status?.toLowerCase() === 'published',
  ).length

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
  }

  // Tasks is the app's de-facto landing page (no separate marketing/dashboard
  // route) — the greeting + live status line replace a plain "Tasks" title
  // with something that actually orients a returning operator.
  //
  // Including whether the simulator answers at all. This page counts how many
  // tasks are ready and said nothing about whether ANY of them could run: the
  // operator found that out one navigation later, in the robot panel. The
  // endpoint proxies the bridge's own health and returns an `error` key only
  // when the bridge did not answer — hardware being unarmed is not an error and
  // does not set it, so this cannot cry wolf about a simulator that is fine.
  const userName =
    typeof storedUser === 'object' &&
    storedUser !== null &&
    'username' in storedUser &&
    typeof (storedUser as Partial<UserLoginInterface>).username === 'string'
      ? (storedUser as Partial<UserLoginInterface>).username
      : ''
  const { data: bridgeHealth } = useSWR<{ error?: string }, Error>(
    { url: endpoints.task.hardwareStatus, method: MethodHTTP.GET },
    fetchApi,
    // Checked on arrival and when the tab is returned to, not polled: this is
    // orientation, not a monitor, and the panel checks properly before a run.
    { revalidateOnFocus: true, refreshInterval: 0, shouldRetryOnError: false },
  )
  const simulatorDown = !!bridgeHealth?.error

  const plural = (n: number) => (n !== 1 ? 's' : '')

  const liveStatusLine = (() => {
    if (rows.length === 0) return 'No tasks yet — create your first one below.'
    // Filtered views describe what is on screen and make no claim about
    // running: "Showing 13 published tasks" is complete and true, and mixing a
    // second, smaller number into the same sentence would not be.
    if (statusFilter === 'published') {
      return `Showing ${publishedCount} published task${plural(publishedCount)}`
    }
    if (statusFilter === 'draft') {
      return `Showing ${draftCount} draft${plural(draftCount)} waiting`
    }
    const statusParts: string[] = []
    // With the simulator down, report the total and let the banner below say
    // why nothing runs. The claim used to stand anyway, directly above a line
    // denying it. The neutral figure is rows.length so it matches the "All"
    // chip exactly — printing a second number also called "published" next to
    // the chip's would trade one contradiction for another.
    if (simulatorDown) {
      statusParts.push(`${rows.length} task${plural(rows.length)}`)
    } else if (runnableCount > 0) {
      statusParts.push(
        `${runnableCount} task${plural(runnableCount)} ready to run`,
      )
    }
    if (draftCount > 0) {
      statusParts.push(`${draftCount} draft${plural(draftCount)} waiting`)
    }
    // rows.length > 0 is established above, so an empty join here means every
    // clause was suppressed, not that there is nothing to show.
    return statusParts.join(' · ')
  })()

  const actionProps = {
    handleOpenDetails,
    setAnalyzeModalVisible,
    setAnalyzingTask,
    handleDelete,
    handleDiscard,
    referenceDataError,
    simulatorDown,
  }

  return (
    // Fills the layout's content area instead of growing past it, so the
    // header, the filter/search band and the pagination stay put while only
    // the card grid scrolls. MainCard defaults to flexShrink:0 (its comment
    // explains why: so an ancestor's overflow:auto can scroll a long page) —
    // this page wants the opposite, and says so here rather than changing the
    // shared component for every other page that does want the default.
    <MainCard
      sx={{
        flex: 1,
        minHeight: 0,
        flexShrink: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
      contentSX={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* ── Band 1: who you are, what is waiting, and the one thing to do ──
          New task sits here, alone, instead of at the end of a row of three
          controls. Position is what makes a primary action primary: it used to
          be the last item in a right-aligned chain of search + filter + button,
          which is the least prominent slot in a left-to-right scan, and it wore
          the same contained-primary styling as the "Retry" button in the error
          state. */}
      <Stack
        direction="row"
        sx={{
          mb: 3,
          gap: 2,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" component="h1" sx={{ fontWeight: 600 }}>
            {userName ? `Welcome back, ${userName}` : 'Welcome back'}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            {liveStatusLine}
          </Typography>
          {/* Amber, and only when the bridge did not answer. This page's own
              vocabulary keeps amber for "something about the robot" — the same
              reservation the panel enforces — and this is the only thing on it
              that qualifies. It says what stops working rather than naming a
              service: the operator can act on "nothing will run", not on
              "the bridge is down". */}
          {simulatorDown && (
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', mt: 0.75 }}
            >
              <AlertTriangle size={14} color={tokenPalette.warning.darker} />
              {/* warning.darker, not .dark: on white the latter measures
                  3.19:1 and fails AA for body text, while darker clears it at
                  5.02:1. The icon beside it may sit at either — it is not
                  text — but it uses the same token so the two read as one
                  mark. */}
              <Typography variant="body2" color="warning.darker">
                The simulator is not responding — tasks cannot run until it is
                back.
              </Typography>
            </Stack>
          )}
        </Box>
        <Button
          variant="contained"
          color="primary"
          size="large"
          startIcon={<Plus size={18} />}
          onClick={handleAdd}
          id="btn-add-task"
          sx={{ flexShrink: 0, px: 2.5, fontWeight: 600 }}
        >
          New task
        </Button>
      </Stack>

      {/* ── Band 2: scope, then query ──
          Filter first and flush LEFT, against the edge of the cards it
          governs; search right. The two were the other way round and both
          pinned to the right edge, far from the content they act on. The
          filter answers "what am I looking at", search answers "which one" —
          reversing them asked the operator to search inside a set they had not
          chosen yet. No standalone row counter: the counts live on the tabs. */}
      <Stack
        direction="row"
        sx={{
          mb: 2.5,
          pb: 2,
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          flexWrap: 'wrap',
          flexShrink: 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <SegmentedControl
          exclusive
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(_e, v) => {
            if (v) {
              setStatusFilter(v)
            }
          }}
          options={[
            { value: 'all', label: `All ${rows.length}` },
            { value: 'draft', label: `${UI_TEXT.draft} ${draftCount}` },
            {
              value: 'published',
              label: `${UI_TEXT.published} ${publishedCount}`,
            },
          ]}
        />
        <OutlinedInput
          inputRef={searchInputRef}
          size="small"
          placeholder="Search tasks…"
          aria-label="Search tasks"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
          }}
          startAdornment={
            <InputAdornment position="start">
              <Search size={16} />
            </InputAdornment>
          }
          endAdornment={
            <InputAdornment position="end">
              <KeycapHint>{modKey()}K</KeycapHint>
            </InputAdornment>
          }
          sx={{ width: 260, maxWidth: '100%' }}
        />
      </Stack>

      {/* ── Card grid ── */}
      {/* The only thing on this page that scrolls. `flex:1 + minHeight:0` lets
          the browser measure what is left after the two bands and the
          pagination — the old `calc(100vh - 280px)` was a hand-guessed header
          height, and editing the header invalidated it silently.

          `p:2 / m:-2` cancel each other out on layout but give the cards two
          spare pixels inside the scroll box, so the hover lift is not clipped
          at the edges. */}
      {isLoadingTasks ? (
        <Box sx={SCROLL_AREA_SX}>
          <Box sx={GRID_SX}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                variant="rounded"
                height={128}
                sx={{ borderRadius: '12px' }}
              />
            ))}
          </Box>
        </Box>
      ) : tasksError ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 7 }}>
          <Typography variant="body2" color="error.dark">
            Couldn&apos;t load tasks. Check your connection and try again.
          </Typography>
          <Button size="small" onClick={() => mutate()}>
            Retry
          </Button>
        </Stack>
      ) : rows.length === 0 ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 7 }}>
          <ListChecks size={32} color={tokenPalette.slate[400]} />
          <Typography variant="body2" color="text.secondary">
            No tasks yet. Create your first robot program visually.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<Plus size={16} />}
            onClick={handleAdd}
            id="btn-add-task-empty"
          >
            New task
          </Button>
        </Stack>
      ) : filteredRows.length === 0 ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', py: 7 }}>
          <Search size={32} color={tokenPalette.slate[400]} />
          <Typography variant="body2" color="text.secondary">
            No tasks match your search or filter.
          </Typography>
          {isFiltering && (
            <Button size="small" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </Stack>
      ) : (
        <>
          <Box sx={SCROLL_AREA_SX}>
            <Box sx={GRID_SX}>
              {filteredRows.map((row) => (
                <TaskCard
                  key={row.id}
                  row={row}
                  canView={canView(row)}
                  canManage={canManage(row.owner)}
                  onOpen={() => handleOpenWorkspace(row.id)}
                  {...actionProps}
                />
              ))}
            </Box>
          </Box>
          {/* No pagination. The grid scrolls, and a list that scrolls does
              not also need pages — the comment this replaces had already named
              the problem ("the page offered two competing ways to reach ten
              cards") and then solved it only for the single-page case. At
              fifteen tasks against a page size of twelve both mechanisms came
              back, and three tasks sat behind an arrow at the bottom of a
              scrolling area, which is the best hiding place on the screen.

              Measured rather than assumed: 20 tasks in the whole database, 15
              for the busiest owner. If a library ever did reach hundreds, the
              answer is still not paging through them — it is the search field
              above, which exists and already answers to Cmd+K. */}
        </>
      )}

      {/* ── Modals ── */}
      <AnalyzeTaskModal
        task={analyzingTask}
        dataMyRobots={dataMyRobots || []}
        open={analyzeModalVisible}
        handleClose={() => setAnalyzeModalVisible(false)}
        dataObjects={dataObjects || []}
        dataLocations={dataLocations || []}
        dataActions={dataActions || []}
      />
    </MainCard>
  )
}

export default ListTasks
