import React from 'react'
import Cookies from 'js-cookie'

export const RandomUserIcon = () => {
  const sessionId = Cookies.get('csrftoken') || '1'

  // Get the last number of the token
  const numbersArray = sessionId.match(/[1-9]/g) || [1]
  const randomIndex = Number(numbersArray[numbersArray.length - 1])

  return <img src={`/robots/${randomIndex}.png`} alt="icon" width="100%" />
}
