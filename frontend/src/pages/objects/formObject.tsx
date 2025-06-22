import React from 'react'
import {
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
import { toast } from 'react-toastify'
import { string as YupString, object as YupObject } from 'yup'
import { AimOutlined, PlusOutlined } from '@ant-design/icons'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { MyRobotType } from 'pages/myrobots/types'
import { useSearchParams } from 'react-router-dom'
import { ObjectDetailType } from './types'

interface FormObjectProps {
  dataObject: ObjectDetailType | undefined
  dataMyRobots: MyRobotType[] | undefined
  insertMode: boolean
  backFunction: () => void
}

export const FormObject = ({
  dataObject,
  dataMyRobots,
  insertMode,
  backFunction,
}: FormObjectProps) => {
  const [addKeyword, setAddKeyword] = React.useState<string>('')
  const [keywordErrors, setKeywordErrors] = React.useState<string[]>([])
  const [searchParams] = useSearchParams()
  const forcedName = searchParams.get('forcedName')
  // const [acquiredPhoto, setAcquiredPhoto] = React.useState<boolean>(false)

  const onSubmit = async (
    values: ObjectDetailType,
    { setStatus, setSubmitting, setFieldError, setFieldTouched },
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    setKeywordErrors([])
    fetchApi({ url: endpoints.home.libraries.object, method, body: values })
      .then(async (res) => {
        if (res && res.nameAlreadyExists) {
          await setFieldTouched('name', true)
          await setFieldError('name', MessageText.alreadyExists)
          setStatus({ success: false })
          return
        }
        if (res && res.keywordExist) {
          setKeywordErrors(res.keywordFound)
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

  const handleGetHeight = async (
    robot: number | null,
    setFieldValue: (field: string, value: any) => void,
    setFieldError: (field: string, value: any) => void,
    setFieldTouched: (field: string, touched: any) => void,
  ) => {
    if (!robot) {
      await setFieldTouched('robot', true)
      await setFieldError('robot', MessageText.requiredField)
      return
    }

    // Mock data
    // setFieldValue('height', 10)

    fetchApi({
      url: endpoints.home.libraries.getCartesianPosition,
      method: MethodHTTP.POST,
      body: { robot },
    }).then((response) => {
      if (response) {
        setFieldValue('height', response.position.Z)
        toast.success('Height acquired')
      }
    })
  }

  const handleGetPhoto = async (
    robot: number | null,
    setFieldValue: (field: string, value: any) => void,
    setFieldError: (field: string, value: any) => void,
    setFieldTouched: (
      field: string,
      isTouched: boolean,
      shouldValidate: boolean,
    ) => void,
  ) => {
    if (!robot) {
      await setFieldTouched('robot', true, true)
      await setFieldError('robot', MessageText.requiredField)
      return
    }

    // Mock data
    /*
    setAcquiredPhoto(true)
    setFieldValue('photo', '/test_image/grid_photo.png')
    setFieldValue('contour', '/test_image/grid_contour.png')
    setFieldValue('shape', '/test_image/grid_shape.png')
    */

    fetchApi({
      url: endpoints.home.libraries.getPhoto,
      method: MethodHTTP.POST,
      body: { robot },
    }).then((response) => {
      if (response) {
        setFieldValue('photo', response.photo)
        setFieldValue('contour', response.contour)
        setFieldValue('shape', response.shape)
        toast.success('Photo acquired')
      }
    })
  }

  return (
    <Formik
      initialValues={{
        id: dataObject?.id || -1,
        name: forcedName || dataObject?.name || '',
        shared: dataObject?.shared || false,
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
        <form
          noValidate
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
        >
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
                  title="Name of the object"
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
                      onChange={() => setFieldValue('shared', !values.shared)}
                      checked={values.shared}
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
                  onChange={(e) => setAddKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (addKeyword) {
                        const newKeywords = [...values.keywords]
                        newKeywords.push(addKeyword)
                        setFieldValue('keywords', newKeywords)
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
                                setFieldValue('keywords', newKeywords)
                                setAddKeyword('')
                              }
                            }}
                            disabled={
                              !addKeyword ||
                              values.keywords.includes(addKeyword)
                            }
                            edge="end"
                          >
                            <PlusOutlined />
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
                      setFieldValue('keywords', newKeywords)

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
                    error={Boolean(touched.robot && errors.robot)}
                    title="Robot use to acquire height and photo"
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
                  title="Define the height of the object"
                  startIcon={<AimOutlined style={{ fontSize: '2em' }} />}
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
                  title="Acquire photo of the object to recognize the shape"
                  startIcon={<AimOutlined style={{ fontSize: '2em' }} />}
                >
                  Get photo
                </Button>
              </Stack>
            </Grid>
            {values.photo && (
              <Grid size={4} container direction="column" alignItems="center">
                <Stack spacing={1}>
                  <CardMedia
                    component="img"
                    title="Original photo acquired"
                    sx={{
                      maxWidth: '500px',
                      maxHeight: '500px',
                      border: '1px solid',
                    }}
                    /*                     image={
                      acquiredPhoto
                        ? values.photo
                        : `data:image/png;base64,${values.photo}`
                    } */
                    image={`data:image/png;base64,${values.photo}`}
                    alt="Object Photo"
                  />
                </Stack>
              </Grid>
            )}
            {values.contour && (
              <Grid size={4} container direction="column" alignItems="center">
                <Stack spacing={1}>
                  <CardMedia
                    component="img"
                    title="Photo elaborated to find rows and columns"
                    sx={{
                      maxWidth: '500px',
                      maxHeight: '500px',
                      border: '1px solid',
                    }}
                    /*                     image={
                      acquiredPhoto
                        ? values.contour
                        : `data:image/png;base64,${values.contour}`
                    } */
                    image={`data:image/png;base64,${values.contour}`}
                    alt="Object Contour"
                  />
                </Stack>
              </Grid>
            )}
            {values.shape && (
              <Grid size={4} container direction="column" alignItems="center">
                <Stack spacing={1}>
                  <CardMedia
                    component="img"
                    title="Photo elaborated to recognize the shape"
                    sx={{
                      maxWidth: '500px',
                      maxHeight: '500px',
                      border: '1px solid',
                    }}
                    /*                     image={
                      acquiredPhoto
                        ? values.shape
                        : `data:image/png;base64,${values.shape}`
                    } */
                    image={`data:image/png;base64,${values.shape}`}
                    alt="Object Shape"
                  />
                </Stack>
              </Grid>
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
                title="Save this object"
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
