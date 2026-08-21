import React from 'react'
import {
  Alert,
  Button,
  CardMedia,
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
import { Crosshair, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { MyRobotType } from 'pages/myrobots/types'

import { ObjectDetailType } from './types'

interface FormObjectProps {
  dataObject: ObjectDetailType | undefined
  dataMyRobots: MyRobotType[] | undefined
  insertMode: boolean
  backFunction: () => void
  readOnly?: boolean
  ownerUsername?: string
}

interface ObjectFormValues extends ObjectDetailType {
  robot: number | '' | null
}

interface SaveObjectResponse {
  nameAlreadyExists?: boolean
  keywordExist?: boolean
  keywordFound?: string[]
}

interface CartesianPositionResponse {
  position?: {
    Z?: number
  }
}

interface ObjectPhotoResponse {
  photo?: string
  contour?: string
  shape?: string
}

type SetFieldValue = FormikHelpers<ObjectFormValues>['setFieldValue']
type SetFieldError = FormikHelpers<ObjectFormValues>['setFieldError']
type SetFieldTouched = FormikHelpers<ObjectFormValues>['setFieldTouched']

export const FormObject = ({
  dataObject,
  dataMyRobots,
  insertMode,
  backFunction,
  readOnly = false,
  ownerUsername,
}: FormObjectProps) => {
  const [addKeyword, setAddKeyword] = React.useState<string>('')
  const [keywordErrors, setKeywordErrors] = React.useState<string[]>([])
  const [searchParams] = useSearchParams()
  const forcedName = searchParams.get('forcedName')

  const onSubmit = (
    values: ObjectFormValues,
    {
      setStatus,
      setSubmitting,
      setFieldError,
      setFieldTouched,
    }: FormikHelpers<ObjectFormValues>,
  ) => {
    if (readOnly) return
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    setKeywordErrors([])
    void fetchApi<SaveObjectResponse, ObjectFormValues>({
      url: endpoints.home.libraries.object,
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

  const handleGetHeight = (
    robot: ObjectFormValues['robot'],
    setFieldValue: SetFieldValue,
    setFieldError: SetFieldError,
    setFieldTouched: SetFieldTouched,
  ) => {
    if (!robot) {
      void setFieldTouched('robot', true)
      setFieldError('robot', MessageText.requiredField)
      return
    }

    void fetchApi<CartesianPositionResponse, { robot: number }>({
      url: endpoints.home.libraries.getCartesianPosition,
      method: MethodHTTP.POST,
      body: { robot: Number(robot) },
    })
      .then((response) => {
        if (typeof response?.position?.Z === 'number') {
          void setFieldValue('height', response.position.Z)
          toast.success('Height acquired')
        }
      })
      .catch(() => {
        // fetchApi already surfaces a toast for the failure.
      })
  }

  const handleGetPhoto = (
    robot: ObjectFormValues['robot'],
    setFieldValue: SetFieldValue,
    setFieldError: SetFieldError,
    setFieldTouched: SetFieldTouched,
  ) => {
    if (!robot) {
      void setFieldTouched('robot', true, true)
      setFieldError('robot', MessageText.requiredField)
      return
    }

    void fetchApi<ObjectPhotoResponse, { robot: number }>({
      url: endpoints.home.libraries.getPhoto,
      method: MethodHTTP.POST,
      body: { robot: Number(robot) },
    })
      .then((response) => {
        if (response) {
          void setFieldValue('photo', response.photo || '')
          void setFieldValue('contour', response.contour || '')
          void setFieldValue('shape', response.shape || '')
          toast.success('Photo acquired')
        }
      })
      .catch(() => {
        // fetchApi already surfaces a toast for the failure.
      })
  }

  return (
    <Formik<ObjectFormValues>
      initialValues={{
        id: dataObject?.id || -1,
        name: forcedName || dataObject?.name || '',
        shared: dataObject?.shared || false,
        owner: dataObject?.owner ?? -1,
        owner__username: dataObject?.owner__username ?? '',
        height: dataObject?.height || 0,
        keywords: dataObject?.keywords || [],
        robot: null,
        photo: dataObject?.photo || '',
        contour: dataObject?.contour || '',
        shape: dataObject?.shape || '',
        force: dataObject?.force || 1,
        weight: dataObject?.weight || 0,
        obj_length: dataObject?.obj_length || 0,
        obj_width: dataObject?.obj_width || 0,
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
        <form noValidate onSubmit={handleSubmit}>
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
                  title="Name of the object"
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
                  title="Share the object with other users"
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
                  title="You can define keywords for this object to be used as synonyms during the chat"
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
              <Divider textAlign="left">Details</Divider>
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
                    onChange={handleChange}
                    disabled={readOnly}
                    error={Boolean(touched.robot && errors.robot)}
                    aria-invalid={Boolean(touched.robot && errors.robot)}
                    aria-describedby={
                      touched.robot && errors.robot
                        ? 'helper-text-robot'
                        : undefined
                    }
                    title="Robot used to acquire height and photo"
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
                    handleGetHeight(
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
                  title="Define the height of the object"
                  startIcon={<Crosshair size={20} />}
                >
                  Get height
                </Button>
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="height"
                  value={values.height || 0}
                  name="height"
                  label="Height"
                  type="number"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  disabled
                  error={Boolean(touched.height && errors.height)}
                  title="Height acquired from the robot"
                />
                {touched.height && errors.height && (
                  <FormHelperText error id="helper-text-height">
                    {errors.height}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="weight"
                  value={values.weight || 0}
                  name="weight"
                  label="Weight (grams)"
                  type="number"
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      max: 65535,
                      step: 1,
                    },
                  }}
                  onBlur={handleBlur}
                  onChange={handleChange}
                  disabled={readOnly}
                  error={Boolean(touched.weight && errors.weight)}
                  title="Weight of the object in grams"
                />
                {touched.weight && errors.weight && (
                  <FormHelperText error id="helper-text-weight">
                    {errors.weight}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="obj_length"
                  value={values.obj_length || 0}
                  name="obj_length"
                  label="Object length (mm)"
                  type="number"
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      max: 65535,
                      step: 1,
                    },
                  }}
                  onBlur={handleBlur}
                  onChange={handleChange}
                  disabled={readOnly}
                  error={Boolean(touched.obj_length && errors.obj_length)}
                  title="Length of the object in millimeters"
                />
                {touched.obj_length && errors.obj_length && (
                  <FormHelperText error id="helper-text-obj_length">
                    {errors.obj_length}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="obj_width"
                  value={values.obj_width || 0}
                  name="obj_width"
                  label="Object width (mm)"
                  type="number"
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      max: 65535,
                      step: 1,
                    },
                  }}
                  onBlur={handleBlur}
                  onChange={handleChange}
                  disabled={readOnly}
                  error={Boolean(touched.obj_width && errors.obj_width)}
                  title="Width of the object in millimeters"
                />
                {touched.obj_width && errors.obj_width && (
                  <FormHelperText error id="helper-text-obj_width">
                    {errors.obj_width}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <Typography id="slider-label">Gripping Force</Typography>
                <Slider
                  id="force"
                  name="force"
                  value={values.force || 1}
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
                  aria-label="Force"
                  onChange={handleChange}
                  disabled={readOnly}
                  valueLabelDisplay="auto"
                  step={1}
                  marks
                  min={1}
                  max={3}
                  style={{ marginTop: 0 }}
                />
              </Stack>
            </Grid>
            <Grid size={12}>
              <Divider textAlign="left">Photo</Divider>
            </Grid>
            <Grid size={12}>
              <Stack spacing={1}>
                <Button
                  onClick={() =>
                    handleGetPhoto(
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
                  title="Acquire photo of the object to recognize the shape"
                  startIcon={<Crosshair size={20} />}
                >
                  Get photo
                </Button>
              </Stack>
            </Grid>
            {values.photo && (
              <Grid
                size={4}
                container
                sx={{ flexDirection: 'column', alignItems: 'center' }}
              >
                <Stack spacing={1}>
                  <CardMedia
                    component="img"
                    title="Original photo acquired"
                    sx={{
                      maxWidth: '500px',
                      maxHeight: '500px',
                      border: '1px solid',
                    }}
                    image={`data:image/png;base64,${values.photo}`}
                    alt="Object Photo"
                  />
                </Stack>
              </Grid>
            )}
            {values.contour && (
              <Grid
                size={4}
                container
                sx={{ flexDirection: 'column', alignItems: 'center' }}
              >
                <Stack spacing={1}>
                  <CardMedia
                    component="img"
                    title="Photo elaborated to find rows and columns"
                    sx={{
                      maxWidth: '500px',
                      maxHeight: '500px',
                      border: '1px solid',
                    }}
                    image={`data:image/png;base64,${values.contour}`}
                    alt="Object Contour"
                  />
                </Stack>
              </Grid>
            )}
            {values.shape && (
              <Grid
                size={4}
                container
                sx={{ flexDirection: 'column', alignItems: 'center' }}
              >
                <Stack spacing={1}>
                  <CardMedia
                    component="img"
                    title="Photo elaborated to recognize the shape"
                    sx={{
                      maxWidth: '500px',
                      maxHeight: '500px',
                      border: '1px solid',
                    }}
                    image={`data:image/png;base64,${values.shape}`}
                    alt="Object Shape"
                  />
                </Stack>
              </Grid>
            )}
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
                    : 'Save this object'
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
