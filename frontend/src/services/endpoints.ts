const PROTOCOL = import.meta.env.VITE_BACKEND_PROTOCOL || 'http://'
const HOST = import.meta.env.VITE_BACKEND_HOST || 'localhost'
const PORT = import.meta.env.VITE_BACKEND_PORT || ':8000'
const API = '/api'

const SERVER = PROTOCOL + HOST + PORT
const SERVER_API = SERVER + API

const AUTH_API = `${SERVER_API}/auth`
const HOME_API = `${SERVER_API}/home`
const GRAPHIC_API = `${SERVER_API}/graphic`
const CHAT_API = `${SERVER_API}/chat`
const TASK_API = `${SERVER_API}/task`

export const endpoints = {
  auth: {
    login: `${AUTH_API}/login/`,
    logout: `${AUTH_API}/logout/`,
    verifyToken: `${AUTH_API}/verifyToken/`,
  },
  home: {
    user: {
      changePassword: `${HOME_API}/changePassword/`,
    },
    libraries: {
      tasks: `${HOME_API}/tasks/`,
      task: `${HOME_API}/task/`,
      objects: `${HOME_API}/objects/`,
      object: `${HOME_API}/object/`,
      locations: `${HOME_API}/locations/`,
      location: `${HOME_API}/location/`,
      actions: `${HOME_API}/actions/`,
      action: `${HOME_API}/action/`,
      myRobots: `${HOME_API}/myRobots/`,
      myRobot: `${HOME_API}/myRobot/`,
      getCartesianPosition: `${HOME_API}/getCartesianPosition/`,
      getJointPosition: `${HOME_API}/getJointPosition/`,
      getPhoto: `${HOME_API}/getPhoto/`,
      pingIp: `${HOME_API}/pingIp/`,
    },
    management: {
      users: `${HOME_API}/users/`,
      user: `${HOME_API}/user/`,
      resetPassword: `${HOME_API}/resetPassword/`,
      robots: `${HOME_API}/robots/`,
      robot: `${HOME_API}/robot/`,
      groups: `${HOME_API}/groups/`,
    },
  },
  graphic: {
    saveGraphicTask: `${GRAPHIC_API}/saveGraphicTask/`,
    getGraphicTask: `${GRAPHIC_API}/getGraphicTask/`,
    objectsGraphic: `${GRAPHIC_API}/objectsGraphic/`,
    locationsGraphic: `${GRAPHIC_API}/locationsGraphic/`,
    actionsGraphic: `${GRAPHIC_API}/actionsGraphic/`,
  },
  chat: {
    newMessage: `${CHAT_API}/newMessage/`,
    saveChatTask: `${CHAT_API}/saveChatTask/`,
  },
  task: {
    run: `${TASK_API}/run/`,
    simulate: `${TASK_API}/simulate/`,
  },
}
