import React from 'react'

import { MainCard } from 'components/MainCard'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

const Faq = () => {
  useDocumentTitle('Instructions & FAQ')
  return (
    <MainCard
      title="Instructions & FAQ"
      subtitle="A quick reference — most of the time the app itself will guide you, but this is here if you need it."
    >
      <h2>Building a task</h2>
      <p>
        Open a task to see the <b>Blockly workspace</b>: a canvas where you
        build a program by dragging coloured blocks from the toolbox on the
        left. The toolbox is grouped into categories — <b>Task Flow</b> (repeat,
        wait for a condition), <b>Robot Actions</b> (pick up, place, open/close
        gripper), <b>Human Actions</b> (pause and show a message, notify
        someone), <b>Conditions</b> (wait for a gesture, a voice command, or an
        object to appear), <b>Saved Tasks</b> (reuse a task you already built),
        and <b>Library</b> (your objects, locations, and skills — drag one of
        these into a dashed slot like &ldquo;Select object…&rdquo; to fill it).
      </p>
      <p>
        Some blocks show a dashed slot with a{' '}
        <b>
          <i>+</i>
        </b>{' '}
        inside, like <i>&ldquo;Select object…&rdquo;</i>. Drag a matching block
        into that slot to fill it. You can save a draft at any time, even with
        empty slots — but a task can&rsquo;t be published or run until every
        slot is filled. Hover a block in the toolbox to preview what it does
        before you use it.
      </p>

      <h2>Getting help from Copilot</h2>
      <p>
        The <b>Copilot</b> panel on the right lets you describe what the robot
        should do in plain language — e.g. &ldquo;pick up the flask and place it
        in the rack&rdquo; — and it builds the matching blocks for you. When it
        proposes blocks, review them and press <b>Apply</b> to build them in
        your workspace — if you already have blocks there, this replaces them,
        and you&rsquo;ll be asked to confirm first. Press <b>Cancel</b> to
        discard the suggestion instead. You can also just ask it questions about
        the task you&rsquo;re building. Turn on <b>Proactive analysis</b> (the
        toggle inside Copilot) if you want it to automatically review your
        workspace and point out problems without you having to ask.
      </p>

      <h2>Testing before you run</h2>
      <p>
        Open the <b>Robot</b> panel (top right) to test your task. It has two
        views: <b>Robot</b> shows the robot moving once a run starts, and{' '}
        <b>Test recognition</b> turns on your camera so you can check that
        gesture, voice, and object detection actually work — you can try this
        any time, even before running anything.
      </p>
      <p>
        If your task needs the camera or microphone to work, the panel tells you
        right there and lets you turn it on with one click — you don&rsquo;t
        need to remember to do it yourself.
      </p>
      <p>
        Before you can run a task, save it with the <b>Save &amp; Publish</b>{' '}
        button in the top bar. A task can be:
      </p>
      <ul>
        <li>
          <b>Draft</b>: not published yet — you can keep editing, but it
          can&rsquo;t run.
        </li>
        <li>
          <b>Published</b>: saved and ready to run.
        </li>
        <li>
          <b>Published, with unpublished changes</b>: still shows as{' '}
          <b>Published</b>, but can&rsquo;t run until you publish or discard
          those changes — the version on screen and the version that would run
          are no longer the same task.
        </li>
      </ul>

      <h2>Running on the real robot</h2>
      <p>
        In the Robot panel, choose <b>Simulate</b> to try the task safely — the
        physical arm never moves. Choose <b>Run on robot</b> to run it on the
        physical arm; you&rsquo;ll be asked to confirm first, since this is a
        real, irreversible motion.
      </p>
      <p>
        The teach-pendant <b>e-stop</b> is always the fastest way to stop the
        robot immediately, no matter what the app shows. The in-app Stop button
        also halts the robot, but it isn&rsquo;t a substitute for the e-stop in
        an emergency.
      </p>

      <h2>Sharing tasks</h2>
      <p>
        A task can be <b>Private</b> (only you can open it) or <b>Shared</b>{' '}
        (visible to other users). You can only edit or delete a task you own — a
        shared task from someone else shows as read-only.
      </p>
    </MainCard>
  )
}

export default Faq
