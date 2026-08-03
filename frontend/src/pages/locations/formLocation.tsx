import React from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { Formik } from 'formik'
import type { FormikHelpers } from 'formik'
import { toast } from 'react-toastify'
import { string as YupString, object as YupObject } from 'yup'
import { Crosshair, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { MyRobotType } from 'pages/myrobots/types'

import { LocationDetailType, CartesianPositionType } from './types'

/** "X: 120mm · Y: 45mm · Z: 200mm" — readable stand-in for the raw
 * {X,Y,Z,RX,RY,RZ,FIG} JSON an operator has no reason to parse by eye. */
const formatPositionSummary = (raw: string): string | null => {
  try {
    const p = JSON.parse(raw) as Partial<CartesianPositionType>
    if (
      typeof p.X !== 'number' ||
      typeof p.Y !== 'number' ||
      typeof p.Z !== 'number'
    ) {
      return null
    }
    return `X: ${Math.round(p.X)}mm · Y: ${Math.round(p.Y)}mm · Z: ${Math.round(p.Z)}mm`
  } catch {
    return null
  }
}

interface FormLocationProps {
  dataLocation: LocationDetailType | undefined
  dataMyRobots: MyRobotType[]
  insertMode: boolean
  backFunction: () => void
  readOnly?: boolean
  ownerUsername?: string
}

interface LocationFormValues extends Omit<LocationDetailType, 'position'> {
  position: string | null
  robot: number | '' | null
}

interface SaveLocationResponse {
  nameAlreadyExists?: boolean
  keywordExist?: boolean
  keywordFound?: string[]
}

interface GetJointPositionResponse {
  position?: unknown
}

type SetFieldValue = FormikHelpers<LocationFormValues>['setFieldValue']
type SetFieldError = FormikHelpers<LocationFormValues>['setFieldError']
type SetFieldTouched = FormikHelpers<LocationFormValues>['setFieldTouched']

export const FormLocation = ({
  dataLocation,
  dataMyRobots,
  insertMode,
  backFunction,
  readOnly = false,
  ownerUsername,
}: FormLocationProps) => {
  const [searchParams] = useSearchParams()
  const [addKeyword, setAddKeyword] = React.useState<string>('')
  const [keywordErrors, setKeywordErrors] = React.useState<string[]>([])
  const [showRawPosition, setShowRawPosition] = React.useState(false)
  const forcedName = searchParams.get('forcedName')

  const onSubmit = (
    values: LocationFormValues,
    {
      setStatus,
      setSubmitting,
      setFieldError,
      setFieldTouched,
    }: FormikHelpers<LocationFormValues>,
  ) => {
    if (readOnly) return
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    setKeywordErrors([])
    void fetchApi<SaveLocationResponse, LocationFormValues>({
      url: endpoints.home.libraries.location,
      method,
      body: values,
    })
      .then((res) => {
        if (res?.nameAlreadyExists) {
          void setFieldTouched('name', true)
          setFieldError('name', MessageText.alreadyExists)
          setStatus({ success: false })
          return
        }

        if (res?.keywordExist) {
          setKeywordErrors(
            Array.isArray(res.keywordFound) ? res.keywordFound : [],
          )
          setStatus({ success: false })
          return
        }

        setStatus({ success: true })
        toast.success(MessageText.success)
        backFunction()
      })
      .catch(() => {
        setStatus({ success: false })
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handleGetPosition = (
    robot: LocationFormValues['robot'],
    setFieldValue: SetFieldValue,
    setFieldError: SetFieldError,
    setFieldTouched: SetFieldTouched,
  ) => {
    if (!robot) {
      void setFieldTouched('robot', true)
      setFieldError('robot', MessageText.requiredField)
      return
    }

    void fetchApi<GetJointPositionResponse, { robot: number }>({
      url: endpoints.home.libraries.getJointPosition,
      method: MethodHTTP.POST,
      body: { robot: Number(robot) },
    })
      .then((response) => {
        if (response?.position) {
          void setFieldValue('position', JSON.stringify(response.position))
          toast.success('Position acquired')
        }
      })
      .catch(() => {
        // fetchApi already surfaces a toast for the failure.
      })
  }

  return (
    <Formik<LocationFormValues>
      initialValues={{
        id: dataLocation?.id || -1,
        name: forcedName || dataLocation?.name || '',
        shared: dataLocation?.shared || false,
        owner: dataLocation?.owner ?? -1,
        owner__username: dataLocation?.owner__username ?? '',
        position: dataLocation?.position
          ? JSON.stringify(dataLocation.position)
          : null,
        robot: null,
        keywords: dataLocation?.keywords || [],
      }}
      validationSchema={YupObject().shape({
        name: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
      })}
      onSubmit={onSubmit}
    >
      {({
        errors,
        handleBlur,
        handleChange,
        handleSubmit,
        isSubmitting,
        touched,
        values,
        setFieldValue,
        setFieldError,
        setFieldTouched,
      }) => (
        <form
          noValidate
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
        >
          <Grid container spacing={3} columns={{ xs: 1, sm: 6, md: 12 }}>
            {readOnly && (
              <Grid size={12}>
                <Alert severity="info">
                  Shared by {ownerUsername ?? 'another user'} — read-only
                </Alert>
              </Grid>
            )}
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="name"
                  value={values.name || ''}
                  name="name"
                  label="Name"
                  required
                  onBlur={handleBlur}
                  onChange={handleChange}
                  disabled={!!forcedName || readOnly}
                  error={Boolean(touched.name && errors.name)}
                  aria-invalid={Boolean(touched.name && errors.name)}
                  aria-describedby={
                    touched.name && errors.name ? 'helper-text-name' : undefined
                  }
                  title="Name of the location"
                />
                {touched.name && errors.name && (
                  <FormHelperText error role="alert" id="helper-text-name">
                    {errors.name}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={1}>
              <Stack spacing={1}>
                <FormControlLabel
                  control={
                    <Checkbox
                      id="shared"
                      value={values.shared}
                      name="shared"
                      onBlur={handleBlur}
                      onChange={() => {
                        void setFieldValue('shared', !values.shared)
                      }}
                      checked={values.shared}
                      disabled={readOnly}
                    />
                  }
                  label="Shared"
                  title="Share this location with other users"
                />
              </Stack>
            </Grid>
            <Grid size={12}>
              <Divider textAlign="left">Keywords</Divider>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="add_keyword"
                  value={addKeyword || ''}
                  name="add_keyword"
                  label="Add keyword"
                  title="You can define keywords for this grid to be used as synonyms during the chat"
                  disabled={readOnly}
                  onChange={(e) => setAddKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (addKeyword) {
                        const newKeywords = [...values.keywords]
                        newKeywords.push(addKeyword)
                        void setFieldValue('keywords', newKeywords)
                        setAddKeyword('')
                      }
                    }
                  }}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => {
                              if (addKeyword) {
                                const newKeywords = [...values.keywords]
                                newKeywords.push(addKeyword)
                                void setFieldValue('keywords', newKeywords)
                                setAddKeyword('')
                              }
                            }}
                            disabled={
                              readOnly ||
                              !addKeyword ||
                              values.keywords.includes(addKeyword)
                            }
                            edge="end"
                            aria-label="Add keyword"
                          >
                            <Plus size={16} />
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Stack>
            </Grid>
            <Grid size={4}>
              <Stack spacing={1} direction="row">
                {values.keywords.map((keyword, index) => (
                  <Chip
                    key={keyword}
                    label={keyword}
                    variant="outlined"
                    onDelete={
                      readOnly
                        ? undefined
                        : () => {
                            const newKeywords = [...values.keywords]
                            newKeywords.splice(index, 1)
                            void setFieldValue('keywords', newKeywords)

                            const newKeywordErrors = keywordErrors.filter(
                              (keywordError) => keywordError !== keyword,
                            )
                            setKeywordErrors(newKeywordErrors)
                          }
                    }
                    color={
                      keywordErrors.includes(keyword) ? 'error' : 'primary'
                    }
                  />
                ))}
              </Stack>
            </Grid>
            <Grid size={12}>
              <Divider textAlign="left">Position</Divider>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <FormControl fullWidth>
                  <InputLabel id="robot-id-label">Robot</InputLabel>
                  <Select
                    labelId="robot-id-label"
                    id="robot"
                    value={values.robot || ''}
                    label="Robot"
                    name="robot"
                    onBlur={handleBlur}
                    onChange={(e) => {
                      void setFieldValue('robot', e.target.value)
                      void setFieldValue('position', '')
                    }}
                    disabled={readOnly}
                    error={Boolean(touched.robot && errors.robot)}
                    aria-invalid={Boolean(touched.robot && errors.robot)}
                    aria-describedby={
                      touched.robot && errors.robot
                        ? 'helper-text-robot'
                        : undefined
                    }
                    title="Robot used to acquire position and photo"
                  >
                    {dataMyRobots?.map((myRobot) => (
                      <MenuItem value={myRobot.id} key={myRobot.id}>
                        {myRobot.name}
                      </MenuItem>
                    ))}
                  </Select>
                  {touched.robot && errors.robot && (
                    <FormHelperText error role="alert" id="helper-text-robot">
                      {errors.robot}
                    </FormHelperText>
                  )}
                </FormControl>
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <Button
                  onClick={() =>
                    handleGetPosition(
                      values.robot,
                      setFieldValue,
                      setFieldError,
                      setFieldTouched,
                    )
                  }
                  color="primary"
                  aria-label="detail"
                  size="medium"
                  variant="outlined"
                  disabled={readOnly}
                  title="Acquire the position of the location"
                  startIcon={<Crosshair size={20} />}
                >
                  Get position
                </Button>
              </Stack>
            </Grid>
            <Grid size={8}>
              <Stack spacing={1}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'flex-end' }}
                >
                  <TextField
                    id="position"
                    value={
                      values.position &&
                      !showRawPosition &&
                      formatPositionSummary(values.position)
                        ? formatPositionSummary(values.position)
                        : values.position || ''
                    }
                    name="position"
                    label="Position"
                    onBlur={handleBlur}
                    onChange={handleChange}
                    disabled
                    error={Boolean(touched.position && errors.position)}
                    title="Position acquired from the robot"
                    fullWidth
                  />
                  {values.position &&
                    formatPositionSummary(values.position) && (
                      <Button
                        size="small"
                        onClick={() => setShowRawPosition((v) => !v)}
                        sx={{ whiteSpace: 'nowrap', mb: 0.5 }}
                      >
                        {showRawPosition ? 'Summary' : 'Raw data'}
                      </Button>
                    )}
                </Stack>
                {touched.position && errors.position && (
                  <FormHelperText error role="alert" id="helper-text-position">
                    {errors.position}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={12}>
              <Button
                disableElevation
                disabled={isSubmitting || readOnly}
                fullWidth
                size="large"
                type="submit"
                variant="contained"
                color="primary"
                title={
                  readOnly
                    ? "Shared by another user — you can't edit this"
                    : 'Save this location'
                }
              >
                Save
              </Button>
            </Grid>
          </Grid>
        </form>
      )}
    </Formik>
  )
}
