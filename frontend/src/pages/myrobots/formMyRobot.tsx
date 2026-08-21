import React from 'react'
import {
  Button,
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
import type { FormikHelpers } from 'formik'
import { toast } from 'react-toastify'
import {
  string as YupString,
  object as YupObject,
  number as YupNumber,
} from 'yup'
import { Ban, QrCode } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'

import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { MessageText, MessageTextMaxLength } from 'utils/messages'
import { RobotType } from 'pages/robots/types'

import { MyRobotDetailType } from './types'

interface FormMyRobotProps {
  dataMyRobot: MyRobotDetailType | undefined
  dataRobots: RobotType[]
  insertMode: boolean
  backFunction: () => void
}

interface SaveMyRobotResponse {
  nameAlreadyExists?: boolean
}

export const FormMyRobot = ({
  dataMyRobot,
  dataRobots,
  insertMode,
  backFunction,
}: FormMyRobotProps) => {
  const [scanning, setScanning] = React.useState(false)

  const onSubmit = (
    values: MyRobotDetailType,
    {
      setStatus,
      setSubmitting,
      setFieldError,
      setFieldTouched,
    }: FormikHelpers<MyRobotDetailType>,
  ) => {
    const method = insertMode ? MethodHTTP.POST : MethodHTTP.PUT
    void fetchApi<SaveMyRobotResponse, MyRobotDetailType>({
      url: endpoints.home.libraries.myRobot,
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

  return (
    <Formik
      initialValues={{
        id: dataMyRobot?.id || -1,
        name: dataMyRobot?.name || '',
        robot: dataMyRobot?.robot || null,
        robot__max_load: dataMyRobot?.robot__max_load ?? null,
        robot__max_open_tool: dataMyRobot?.robot__max_open_tool ?? null,
      }}
      validationSchema={YupObject().shape({
        name: YupString()
          .max(255, MessageTextMaxLength(255))
          .required(MessageText.requiredField),
        robot: YupNumber().required(MessageText.requiredField),
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
            <Grid size={8}>
              <Stack spacing={1}>
                <TextField
                  id="name"
                  value={values.name || ''}
                  name="name"
                  label="Name"
                  required
                  onBlur={handleBlur}
                  onChange={handleChange}
                  error={Boolean(touched.name && errors.name)}
                  aria-invalid={Boolean(touched.name && errors.name)}
                  aria-describedby={
                    touched.name && errors.name ? 'helper-text-name' : undefined
                  }
                  title="Name of your personal robot"
                />
                {touched.name && errors.name && (
                  <FormHelperText error role="alert" id="helper-text-name">
                    {errors.name}
                  </FormHelperText>
                )}
              </Stack>
            </Grid>
            <Grid size={4}>
              <Stack spacing={1}>
                <FormControl fullWidth>
                  <InputLabel id="robot-label" required>
                    Robot
                  </InputLabel>
                  <Select
                    labelId="robot-label"
                    id="robot"
                    value={values.robot || ''}
                    label="Robot"
                    name="robot"
                    required
                    onBlur={handleBlur}
                    onChange={handleChange}
                    error={Boolean(touched.robot && errors.robot)}
                    aria-invalid={Boolean(touched.robot && errors.robot)}
                    aria-describedby={
                      touched.robot && errors.robot
                        ? 'helper-text-robot'
                        : undefined
                    }
                    title="Select the robot from the fleet that will be used as your personal robot"
                  >
                    {dataRobots?.map((robot) => (
                      <MenuItem value={robot.id} key={robot.id}>
                        {robot.name}
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
            <Grid size={12}>
              <Stack spacing={1}>
                <Button
                  color="primary"
                  aria-label="detail"
                  size="medium"
                  title="Acquire robot ID from webcam"
                  startIcon={
                    scanning ? <Ban size={20} /> : <QrCode size={20} />
                  }
                  onClick={() => setScanning(!scanning)}
                >
                  {scanning
                    ? 'Stop acquiring from webcam'
                    : 'Acquire from webcam'}
                </Button>
              </Stack>
            </Grid>
            {scanning && (
              <>
                <Grid size={4} />
                <Grid size={4}>
                  <Stack spacing={1}>
                    <Scanner
                      onScan={(result) => {
                        if (result && result.length > 0) {
                          setScanning(false)
                          const code = result[0].rawValue
                          if (
                            dataRobots.find(
                              (robot) => robot.id.toString() === code,
                            )
                          ) {
                            void setFieldValue('robot', Number(code))
                          } else {
                            void setFieldTouched('robot', true)
                            setFieldError('robot', MessageText.robotIdNotFound)
                          }
                        }
                      }}
                      constraints={{ facingMode: 'environment' }}
                    />
                  </Stack>
                </Grid>
                <Grid size={4} />
              </>
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
                title="Save this personal robot"
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
