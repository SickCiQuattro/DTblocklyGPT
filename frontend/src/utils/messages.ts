export enum MessageText {
  requiredField = 'Required field',
  emailNotValid = 'Invalid email format',
  lengthNotValid = 'Invalid length',
  invalidForm = 'Invalid data',
  sessioneExpired = 'Session expired',
  onlyEdit = 'Available only in edit mode',
  newPasswordEqualOld = 'The new password is the same as the current one',
  incorrectPassword = 'Incorrect password',
  invalidCredentials = 'Invalid credentials',
  serverError = 'Server error',
  logoutSuccess = 'Logged out successfully',
  noConnection = 'Server connection problem',
  passwordMismatch = 'Passwords do not match',
  alreadyExists = 'This value already exists',
  success = 'Operation completed successfully',
  valueNotValid = 'Invalid value',
  invalidDate = 'The start date must be before the end date',
  forbidden = 'Forbidden. Try to login again',
  badRequest = 'Bad request',
  valueNotFound = 'Value not found',
  robotIdNotFound = 'Robot ID not found',
  runningTask = 'Task successfully started',
  analyzedTask = 'Task analysis completed',
  copiedInClipboard = 'Copied in clipboard',
}

export const MessageTextMinLength = (minLength: number) =>
  `Minimum length ${minLength} characters`

export const MessageTextMaxLength = (maxLength: number) =>
  `Maximum length ${maxLength} characters`

export const MessageTextValueBetween = (minValue: number, maxValue: number) =>
  `Value must be between ${minValue} - ${maxValue}`
