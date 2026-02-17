import {
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Typography,
} from '@mui/material'
import { MainCard } from 'components/MainCard'
import React from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { activeItem } from 'store/reducers/menu'

const Homepage = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()

  React.useEffect(() => {
    dispatch(activeItem('homepage'))
  }, [])

  return (
    <MainCard
      title="Let's define a new task: how do you want to proceed?"
      subtitle="Click on the cards below to start."
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
        }}
      >
        <Card
          style={{
            marginRight: '1rem',
          }}
        >
          <CardActionArea
            onClick={() => {
              navigate('/task/add?type=chat')
              dispatch(activeItem('definechat'))
            }}
            title="Create a new task by chat"
          >
            <CardMedia
              component="img"
              image="/pages/chat_example.png"
              height={300}
              alt="chat"
            />
            <CardContent>
              <Typography gutterBottom variant="h3" component="div">
                Chat
              </Typography>
              <Typography variant="h5" color="text.secondary">
                Create a new task by chatting
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card
          style={{
            marginRight: '1rem',
          }}
        >
          <CardActionArea
            onClick={() => {
              navigate('/task/add?type=graphic')
              dispatch(activeItem('definegraphic'))
            }}
            title="Create a new task by graphic interface"
          >
            <CardMedia
              component="img"
              image="/pages/graphic_example.png"
              height={300}
              alt="graphic"
            />
            <CardContent>
              <Typography gutterBottom variant="h3" component="div">
                Graphic
              </Typography>
              <Typography variant="h5" color="text.secondary">
                Create a new task by the graphic interface
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card>
          <CardActionArea
            onClick={() => {
              navigate('/task/add?type=multimodal')
              dispatch(activeItem('definemultimodal'))
            }}
            title="Create a new task by multimodal interface"
          >
            <CardMedia
              component="img"
              image="/pages/multimodal_example.png"
              height={300}
              alt="multimodal"
            />
            <CardContent>
              <Typography gutterBottom variant="h3" component="div">
                Multimodal
              </Typography>
              <Typography variant="h5" color="text.secondary">
                Create a new task by the multimodal interface
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </div>
    </MainCard>
  )
}

export default Homepage
