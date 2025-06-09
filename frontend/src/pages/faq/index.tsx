import { MainCard } from 'components/MainCard'
import React from 'react'

const Faq = () => {
  return (
    <MainCard
      title="Instructions & FAQ"
      subtitle="Here you can understand how to use the application and exploit its full potential! "
    >
      <h2>About</h2>
      <p>
        The PRAISE application is designed to support users in programming
        robotic systems. This user-friendly tool streamlines the process of
        creating customized Pick&Place tasks using two different approaches: a{' '}
        <b>Chat</b> and a <b>Graphic Interface</b>.
      </p>
      <p>
        In the Chat you can assemble all the defined libraries or define new
        ones to create a task interacting only in natural language.
      </p>
      <p>
        {' '}
        In the Graphic interface you can create or edit a task interacting with
        a flow diagram.
      </p>
      <h2>Steps</h2>
      <p>
        The task is divided into 3 main steps: <b>Pick</b>, <b>Place</b> and an
        optional <b>Processing</b>. For each step you can define a library for
        performing the operations.
      </p>
      <ul>
        <li>
          <b>Pick</b>: in this step you can define the object that will be
          grasped. You can define the <b>Object</b> with its details:
          <ul>
            <li>
              <i>Name</i>: the name of the object
            </li>
            <li>
              <i>Shared</i>: if the object is shared with other users
            </li>
            <li>
              <i>Keywords</i>: keywords used as synonyms for refer the object
            </li>
            <li>
              <i>Height</i>: the height acquired from the robot at which to
              perform the grasp object
            </li>
            <li>
              <i>Force</i>: the force with which to grip the object
            </li>
            <li>
              <i>Photo</i>: it is also possible to acquire a photo of the object
              to recognize automatically the shape of the object
            </li>
          </ul>
        </li>
        <br />
        <li>
          <b>Place</b>: in this step you can define the location where to store
          the grasped object. You can define the <b>Location</b> with its
          details:
          <ul>
            <li>
              <i>Name</i>: the name of the location
            </li>
            <li>
              <i>Shared</i>: if the location is shared with other users
            </li>
            <li>
              <i>Keywords</i>: keywords used as synonyms for refer the location
            </li>
            <li>
              <i>Position</i>: the position of the location acquired by the
              robot
            </li>
          </ul>
        </li>
        <br />
        <li>
          <b>Processing</b>: in this step you can define the processing
          operation to be performed on the grasped object. You can define the{' '}
          <b>Action</b> with its details:
          <ul>
            <li>
              <i>Name</i>: the name of the action
            </li>
            <li>
              <i>Shared</i>: if the action is shared with other users
            </li>
            <li>
              <i>Keywords</i>: keywords used as synonyms for refer the action
            </li>
            <li>
              <i>Speed</i>: the speed of the action
            </li>
            <li>
              <i>Pattern</i>: use an already defined pattern of the action
              (Linear, Circular, Cross)
            </li>
            <li>
              <i>Height</i>: the height acquired from the robot at which to
              perform the action
            </li>
            <li>
              <i>Points</i>: it is also possible to define a custom pattern
              acquiring points with the robot
            </li>
          </ul>
        </li>
      </ul>
      <h2>My robots</h2>
      <p>
        In this section you can define your robots by selecting an already added
        robot at system level by the Managers. You can define the select the
        robot using a list or a QR code. To acquire the QR code you can use your
        camera or upload a photo of the QR code.
      </p>
    </MainCard>
  )
}

export default Faq
