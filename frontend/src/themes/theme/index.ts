// DTblocklyGPT Design System v1.0 — MUI Theme Tokens
// Primary: Indigo #6366F1 | Font: Geist → Inter → General Sans
// Light-mode default. Dark mode: border token rgba(99,102,241,0.20).

export const Theme = () => {
  const greyPrimary = [
    '#ffffff', // 0
    '#fafafa', // 50
    '#f5f5f5', // 100
    '#f0f0f0', // 200
    '#d9d9d9', // 300
    '#bfbfbf', // 400
    '#8c8c8c', // 500
    '#595959', // 600
    '#262626', // 700
    '#141414', // 800
    '#000000', // 900
  ]
  const greyAscent = ['#fafafa', '#bfbfbf', '#434343', '#1f1f1f']
  const greyConstant = ['#fafafb', '#e6ebf1']

  const grey = [...greyPrimary, ...greyAscent, ...greyConstant]

  return {
    primary: {
      lighter: 'hsl(239, 84%, 95%)',   // #eef2ff
      100:     'hsl(239, 84%, 90%)',
      200:     'hsl(239, 84%, 85%)',   // #c7d2fe
      light:   'hsl(239, 84%, 75%)',
      400:     '#818CF8',              // Indigo 400
      main:    '#6366F1',              // Indigo 500 — brand accent
      dark:    '#4F46E5',              // Indigo 600
      700:     '#4338CA',              // Indigo 700
      darker:  '#3730A3',              // Indigo 800
      900:     '#312E81',              // Indigo 900
      contrastText: '#FFFFFF',
    },
    secondary: {
      lighter: grey[1],
      100:     grey[2],
      200:     grey[3],
      light:   grey[4],
      400:     grey[5],
      main:    grey[6],
      600:     grey[7],
      dark:    grey[8],
      800:     grey[9],
      darker:  grey[10],
      A50:     grey[11],
      A100:    grey[0],
      A200:    grey[13],
      A300:    grey[14],
      contrastText: grey[0],
    },
    error: {
      lighter: '#fde8e8',
      light:   '#F87171',
      main:    '#EF4444',
      dark:    '#DC2626',
      darker:  '#B91C1C',
      contrastText: '#FFFFFF',
    },
    warning: {
      lighter: '#fef3c7',
      light:   '#FCD34D',
      main:    '#F59E0B',
      dark:    '#D97706',
      darker:  '#B45309',
      contrastText: '#FFFFFF',
    },
    info: {
      lighter: '#e0f2fe',
      light:   '#38BDF8',
      main:    '#0EA5E9',
      dark:    '#0284C7',
      darker:  '#0369A1',
      contrastText: '#FFFFFF',
    },
    success: {
      lighter: '#d1fae5',
      light:   '#34D399',
      main:    '#10B981',
      dark:    '#059669',
      darker:  '#047857',
      contrastText: '#FFFFFF',
    },
    grey,
  }
}
