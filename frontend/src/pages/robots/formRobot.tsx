import React from 'react'
import {
  Button,
  Divider,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { Formik } from 'formik'
import { toast } from 'react-toastify'
import {
  string as YupString,
  object as YupObject,
  number as YupNumber,
} from 'yup'
import { ApiOutlined } from '@ant-design/icons'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { RobotModel, RobotType } from './types'

interface FormRobotProps {
  data: RobotType | undefined
  insertMode: boolean
  backFunction: () => void
}

export const FormRobot = ({
  data,
  insertMode,
  backFunction,
}: FormRobotProps) => {
  const onSubmit = async (
    values: RobotType,
    { setStatus, setSubmitting, setFieldTouched, setFieldError },
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    fetchApi({ url: endpoints.home.management.robot, method, body: values })
      .then(async (res) => {
        if (res && res.nameAlreadyExists) {
          await setFieldTouched('name', true)
          await setFieldError('name', MessageText.alreadyExists)
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

  const handleCheckIp = async (
    ip: string | null,
    port: number | null,
    setFieldError: (field: string, value: any) => void,
    setFieldTouched: (field: string, touched: any) => void,
  ) => {
    if (!ip || !port) {
      if (!ip) {
        await setFieldTouched('ip', true)
        await setFieldError('ip', MessageText.requiredField)
      }
      if (!port) {
        await setFieldTouched('port', true)
        await setFieldError('port', MessageText.requiredField)
      }
      return
    }
    fetchApi({
      url: endpoints.home.libraries.pingIp,
      method: MethodHTTP.POST,
      body: { ip },
    }).then((response) => {
      if (response) {
        toast.success('IP available')
      }
    })
  }

  return (
    <Formik
      initialValues={{
        id: data?.id || -1,
        name: data?.name || '',
        ip: data?.ip || '',
        port: data?.port || 0,
        model: data?.model || '',
        cameraip: data?.cameraip || '',
        max_load: data?.max_load || 0,
        max_open_tool: data?.max_open_tool || 0,
      }}
      validationSchema={YupObject().shape({
        name: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
        ip: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
        model: YupString().required(MessageText.requiredField),
        port: YupNumber().required(MessageText.requiredField),
        cameraip: YupString()
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
                  error={Boolean(touched.name && errors.name)}
                  title="Name of the robot"
                />
                {touched.name && errors.name && (
                  <FormHelperText error id="helper-text-name">
                    {errors.name}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <FormControl fullWidth>
                  <InputLabel id="model-label">Model</InputLabel>
                  <Select
                    labelId="model-label"
                    id="model"
                    value={values.model || ''}
                    label="Model"
                    name="model"
                    onBlur={handleBlur}
                    onChange={handleChange}
                    error={Boolean(touched.model && errors.model)}
                    title="Model of the robot"
                  >
                    {Object.entries(RobotModel).map(([k, v]) => (
                      <MenuItem value={k} key={k}>
                        {v}
                      </MenuItem>
                    ))}
                  </Select>
                  {touched.model && errors.model && (
                    <FormHelperText error id="helper-text-model">
                      {errors.model}
                    </FormHelperText>
                  )}
                </FormControl>
              </Stack>
            </Grid>
            <Grid size={12}>
              <Divider textAlign="left">Connection</Divider>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="ip"
                  value={values.ip || ''}
                  name="ip"
                  label="IP"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  title="IP address of the robot"
                  inputProps={{ maxLength: 15 }}
                  error={Boolean(touched.ip && errors.ip)}
                />
                {touched.ip && errors.ip && (
                  <FormHelperText error id="helper-text-ip">
                    {errors.ip}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>

            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="port"
                  value={values.port || 0}
                  name="port"
                  label="Port"
                  type="number"
                  inputProps={{ min: 0, max: 65535, step: 1 }}
                  onBlur={handleBlur}
                  onChange={handleChange}
                  error={Boolean(touched.port && errors.port)}
                  title="Port of the address to connect to the robot"
                />
                {touched.port && errors.port && (
                  <FormHelperText error id="helper-text-port">
                    {errors.port}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <Button
                  onClick={() =>
                    handleCheckIp(
                      values.ip,
                      values.port,
                      setFieldError,
                      setFieldTouched,
                    )
                  }
                  color="primary"
                  aria-label="detail"
                  size="medium"
                  title="Check connection to the robot IP and port"
                  startIcon={<ApiOutlined style={{ fontSize: '2em' }} />}
                >
                  Check connection
                </Button>
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="cameraip"
                  value={values.cameraip || ''}
                  name="cameraip"
                  label="Camera IP"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  inputProps={{ maxLength: 15 }}
                  error={Boolean(touched.cameraip && errors.cameraip)}
                  title="IP address of the camera of the robot"
                />
                {touched.cameraip && errors.cameraip && (
                  <FormHelperText error id="helper-text-cameraip">
                    {errors.cameraip}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={12}>
              <Divider textAlign="left">Techical details</Divider>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="max_load"
                  value={values.max_load || 0}
                  name="max_load"
                  label="Max load (grams)"
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
                  error={Boolean(touched.max_load && errors.max_load)}
                  title="Maximum load the robot can handle in grams"
                />
                {touched.max_load && errors.max_load && (
                  <FormHelperText error id="helper-text-max_load">
                    {errors.max_load}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={2}>
              <Stack spacing={1}>
                <TextField
                  id="max_open_tool"
                  value={values.max_open_tool || 0}
                  name="max_open_tool"
                  label="Max open tool (mm)"
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
                  error={Boolean(touched.max_open_tool && errors.max_open_tool)}
                  title="Maximum opening of the robot tool in millimeters"
                />
                {touched.max_open_tool && errors.max_open_tool && (
                  <FormHelperText error id="helper-text-max_open_tool">
                    {errors.max_open_tool}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={12}>
              <Button
                disableElevation
                disabled={isSubmitting}
                fullWidth
                size="large"
                type="submit"
                variant="contained"
                color="primary"
                title="Save this robot"
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
