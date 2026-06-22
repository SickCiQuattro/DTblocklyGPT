import React from 'react'
import {
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
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Formik } from 'formik'
import type { FormikHelpers } from 'formik'
import { toast } from 'react-toastify'
import { string as YupString, object as YupObject } from 'yup'
import { Target, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { ConfirmPopover } from 'components/ConfirmPopover'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { MyRobotType } from 'pages/myrobots/types'
import { JointPositionType } from 'pages/locations/types'

import { ActionDetailType, listPatterns } from './types'

interface FormActionProps {
  dataAction: ActionDetailType | undefined
  dataMyRobots: MyRobotType[]
  insertMode: boolean
  backFunction: () => void
}

interface ActionFormValues extends ActionDetailType {
  robot: number | '' | null
}

interface SaveActionResponse {
  nameAlreadyExists?: boolean
  keywordExist?: boolean
  keywordFound?: string[]
}

interface GetJointPositionResponse {
  position?: JointPositionType
}

type SetFieldValue = FormikHelpers<ActionFormValues>['setFieldValue']
type SetFieldError = FormikHelpers<ActionFormValues>['setFieldError']
type SetFieldTouched = FormikHelpers<ActionFormValues>['setFieldTouched']

const parsePointsField = (point: string): { points: JointPositionType[] } => {
  try {
    const parsedPoint: unknown = JSON.parse(point)
    if (typeof parsedPoint === 'object' && parsedPoint !== null) {
      const points = (parsedPoint as { points?: unknown }).points
      if (Array.isArray(points)) {
        return { points: points as JointPositionType[] }
      }
    }
  } catch {
    return { points: [] }
  }

  return { points: [] }
}

const stringifyPointsField = (points: JointPositionType[]): string => {
  return JSON.stringify({ points })
}

export const FormAction = ({
  dataAction,
  dataMyRobots,
  insertMode,
  backFunction,
}: FormActionProps) => {
  const [searchParams] = useSearchParams()
  const [addKeyword, setAddKeyword] = React.useState<string>('')
  const [keywordErrors, setKeywordErrors] = React.useState<string[]>([])
  const forcedName = searchParams.get('forcedName')

  const onSubmit = (
    values: ActionFormValues,
    {
      setStatus,
      setSubmitting,
      setFieldError,
      setFieldTouched,
    }: FormikHelpers<ActionFormValues>,
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    setKeywordErrors([])
    void fetchApi<SaveActionResponse, ActionFormValues>({
      url: endpoints.home.libraries.action,
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
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handleGetPosition = (
    robot: ActionFormValues['robot'],
    point: string,
    setFieldValue: SetFieldValue,
    setFieldError: SetFieldError,
    setFieldTouched: SetFieldTouched,
  ) => {
    if (!robot) {
      void setFieldTouched('robot', true)
      setFieldError('robot', MessageText.requiredField)
      return
    }

    // Mock data
    /*
    const newPoint =
      '{"X": 0, "Y": 0, "Z": 0, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}'
    const pointObj = JSON.parse(point)
    const newArray = [...pointObj.points, newPoint]
    const newPointObj = { points: newArray }
    setFieldValue('points', JSON.stringify(newPointObj))
    */

    void fetchApi<GetJointPositionResponse, { robot: number }>({
      url: endpoints.home.libraries.getJointPosition,
      method: MethodHTTP.POST,
      body: { robot: Number(robot) },
    }).then((response) => {
      if (response?.position) {
        const pointObj = parsePointsField(point)
        const newArray = [...pointObj.points, response.position]
        void setFieldValue('points', stringifyPointsField(newArray))
        toast.success('Point acquired')
      }
    })
  }

  const handleDelete = (
    point: string,
    index: number,
    setFieldValue: SetFieldValue,
  ) => {
    const pointObj = parsePointsField(point)
    const newArray = pointObj.points.filter(
      (_: JointPositionType, i: number) => i !== index,
    )
    void setFieldValue('points', stringifyPointsField(newArray))
  }

  return (
    <Formik<ActionFormValues>
      initialValues={{
        id: dataAction?.id || -1,
        name: forcedName || dataAction?.name || '',
        shared: dataAction?.shared || false,
        points: dataAction?.points || '{"points": []}',
        pattern: dataAction?.pattern || '',
        speed: dataAction?.speed || 1,
        keywords: dataAction?.keywords || [],
        robot: null,
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
      }) => {
        const parsedPoints = parsePointsField(values.points)

        return (
          <form noValidate onSubmit={handleSubmit}>
            <Grid container spacing={3} columns={{ xs: 1, sm: 6, md: 12 }}>
              <Grid size={2}>
                <Stack spacing={1}>
                  <TextField
                    id="name"
                    value={values.name || ''}
                    name="name"
                    label="Name"
                    onBlur={handleBlur}
                    onChange={handleChange}
                    disabled={!!forcedName}
                    error={Boolean(touched.name && errors.name)}
                    title="Name of the routine"
                  />
                  {touched.name && errors.name && (
                    <FormHelperText error id="helper-text-name">
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
                      />
                    }
                    label="Shared"
                    title="Share this routine with other users"
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
                    title="You can define keywords for this routine to be used as synonyms during the chat"
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
                                !addKeyword ||
                                values.keywords.includes(addKeyword)
                              }
                              edge="end"
                              size="large"
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
                      onDelete={() => {
                        const newKeywords = [...values.keywords]
                        newKeywords.splice(index, 1)
                        void setFieldValue('keywords', newKeywords)

                        const newKeywordErrors = keywordErrors.filter(
                          (keywordError) => keywordError !== keyword,
                        )
                        setKeywordErrors(newKeywordErrors)
                      }}
                      color={
                        keywordErrors.includes(keyword) ? 'error' : 'primary'
                      }
                    />
                  ))}
                </Stack>
              </Grid>
              <Grid size={12}>
                <Divider textAlign="left">Details</Divider>
              </Grid>
              <Grid size={2}>
                <Stack spacing={1}>
                  <Typography id="slider-label">Speed</Typography>
                  <Slider
                    id="speed"
                    name="speed"
                    value={values.speed || 1}
                    valueLabelFormat={(val: number) => {
                      if (val === 1) return 'Low'
                      switch (val) {
                        case 1:
                          return 'Low'
                        case 2:
                          return 'Medium'
                        case 3:
                          return 'High'
                        default:
                          return ''
                      }
                    }}
                    aria-label="Speed"
                    onChange={handleChange}
                    valueLabelDisplay="auto"
                    step={1}
                    marks
                    min={1}
                    max={3}
                    style={{ marginTop: 0 }}
                  />
                </Stack>
              </Grid>
              <Grid size={1} />
              <Grid size={2}>
                <Stack spacing={1}>
                  <FormControl fullWidth>
                    <InputLabel id="pattern-id-label">Pattern</InputLabel>
                    <Select
                      labelId="pattern-id-label"
                      id="pattern"
                      value={values.pattern || ''}
                      label="Pattern"
                      name="pattern"
                      onBlur={handleBlur}
                      onChange={handleChange}
                      error={Boolean(touched.pattern && errors.pattern)}
                      title="Pattern of the routine. You can use already defined pattern or define a custom list of points from the Points section"
                    >
                      {listPatterns.map((pattern) => (
                        <MenuItem value={pattern.id} key={pattern.id}>
                          {pattern.name}
                        </MenuItem>
                      ))}
                    </Select>
                    {touched.pattern && errors.pattern && (
                      <FormHelperText error id="helper-text-pattern">
                        {errors.pattern}
                      </FormHelperText>
                    )}
                  </FormControl>
                </Stack>
              </Grid>
              <Grid size={12}>
                <Divider textAlign="left">Define custom pattern</Divider>
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
                      error={Boolean(touched.robot && errors.robot)}
                      title="Robot to use to acquire height and points"
                    >
                      {dataMyRobots?.map((myRobot) => (
                        <MenuItem value={myRobot.id} key={myRobot.id}>
                          {myRobot.name}
                        </MenuItem>
                      ))}
                    </Select>
                    {touched.robot && errors.robot && (
                      <FormHelperText error id="helper-text-robot">
                        {errors.robot}
                      </FormHelperText>
                    )}
                  </FormControl>
                </Stack>
              </Grid>
              <Grid size={10}>
                <Stack spacing={1}>
                  <Button
                    onClick={() =>
                      handleGetPosition(
                        values.robot,
                        values.points,
                        setFieldValue,
                        setFieldError,
                        setFieldTouched,
                      )
                    }
                    color="primary"
                    variant="outlined"
                    aria-label="detail"
                    size="medium"
                    title="Acquire a point to define a custom pattern"
                    startIcon={<Target size={18} />}
                  >
                    Get point
                  </Button>
                </Stack>
              </Grid>
              {parsedPoints.points.map(
                (point: JointPositionType, index: number) => (
                  <React.Fragment
                    key={`${Math.random()}-${JSON.stringify(point)}`}
                  >
                    <Grid size={10}>
                      <Stack spacing={1}>
                        <TextField
                          id={`point-${index}`}
                          value={JSON.stringify(point)}
                          name={`point-${index}`}
                          label={`Point ${index + 1}`}
                          disabled
                        />
                      </Stack>
                    </Grid>
                    <Grid size={2}>
                      <Stack spacing={1}>
                        <ConfirmPopover
                          title="Delete?"
                          onConfirm={() =>
                            handleDelete(values.points, index, setFieldValue)
                          }
                        >
                          {(onOpen) => (
                            <Button
                              color="error"
                              title="Delete this point"
                              onClick={onOpen}
                            >
                              Delete
                            </Button>
                          )}
                        </ConfirmPopover>
                      </Stack>
                    </Grid>
                  </React.Fragment>
                ),
              )}
              <Grid size={12}>
                <Button
                  disableElevation
                  disabled={isSubmitting}
                  fullWidth
                  size="large"
                  type="submit"
                  variant="contained"
                  color="primary"
                  title="Save this routine"
                >
                  Save
                </Button>
              </Grid>
            </Grid>
          </form>
        )
      }}
    </Formik>
  )
}
