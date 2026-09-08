import React from 'react'

import { MainCard } from 'components/MainCard'
import { useDocumentTitle } from 'hooks/useDocumentTitle'

/**
 * The page a first-time operator should not need.
 *
 * Written for someone who does not program and has not worked with a robot
 * arm, so it explains what things DO and never how they are built: no block
 * type names, no endpoints, no talk of Blockly or ROS. Every control it names
 * is named with the words printed on that control, because a reference whose
 * vocabulary differs from the screen sends the reader hunting.
 *
 * Two things are deliberately absent.
 *
 * It does not say what happens if the operator does nothing while the robot
 * waits. That is the third of the three prediction questions in the user study
 * (studio-utenti/04-compiti.md), and this page is reachable during a session:
 * answering it here would answer the question for the participant and the
 * measurement would be of this paragraph rather than of the system.
 *
 * And it does not list the toolbox categories one by one. The toolbox is on
 * screen, labelled, and one click from every block's own description — a
 * duplicate list here would be one more place to drift out of date, and this
 * project has spent real time on exactly that kind of drift.
 */
const Faq = () => {
  useDocumentTitle('Instructions & FAQ')
  return (
    <MainCard
      title="Instructions & FAQ"
      subtitle="Most of what you need is on screen and labelled. This is here for the rest."
    >
      <h2>What you are building</h2>
      <p>
        A <b>task</b> is a list of steps the robot carries out in order. You
        build it by dragging blocks into the workspace, or by describing it to{' '}
        <b>Copilot</b> in plain language — whichever you prefer, and you can mix
        the two.
      </p>
      <p>
        Blocks are grouped on the left by what they do, and hovering one shows a
        preview of it with a sentence explaining it. Some blocks have a dashed
        slot — <i>&ldquo;Select object…&rdquo;</i>,{' '}
        <i>&ldquo;Select condition…&rdquo;</i> — waiting for something to be
        dropped in. Click the slot to pick from a list, or drag a block into it.
      </p>

      <h2>Steps the robot does, and steps you do</h2>
      <p>
        Most steps are the robot&rsquo;s: pick something up, put it somewhere,
        run a skill it has been taught. Two of them are yours.
      </p>
      <ul>
        <li>
          <b>Pause and show message</b> stops the robot and puts your message on
          screen. It stays stopped until the thing you chose under{' '}
          <i>&ldquo;Resume when&rdquo;</i> happens — you press the Confirm
          button, say a word, make a hand gesture, or put an object where the
          camera can see it.
        </li>
        <li>
          <b>Show message and continue</b> also puts a message on screen, but
          the robot keeps working. Use it to tell the person what to get ready
          for while the arm is still moving.
        </li>
      </ul>
      <p>
        The difference between the two is the only thing you need to remember
        here: one waits for you, the other does not.
      </p>

      <h2>Saving, and what actually runs</h2>
      <p>
        There is one save button, at the top right, and it does the right thing
        on its own:
      </p>
      <ul>
        <li>
          <b>Save &amp; Publish</b> — the task is complete, so saving also makes
          it the version that runs.
        </li>
        <li>
          <b>Save draft</b> — something is still missing, usually an empty slot.
          Your work is kept, but the task cannot run yet. The warning next to
          the task name says what is missing.
        </li>
      </ul>
      <p>
        <b>Run always uses the published version</b>, not whatever is on screen.
        If you edit a published task and do not publish the change, the header
        says <i>Unpublished changes</i> — that is the app telling you the two
        have drifted apart, and it will not run until you publish or discard
        them. The same rule applies to a task used inside another one: it runs
        the version its author published.
      </p>

      <h2>Trying it</h2>
      <p>
        <b>Run</b> opens the robot panel on the right. It has two views:{' '}
        <b>Robot</b> shows the arm while a task runs, and{' '}
        <b>Test recognition</b> turns on your camera so you can check that
        gestures, voice and object detection are working — you can use that at
        any time, before running anything.
      </p>
      <p>
        Before it starts, the panel lists anything that would get in the way and
        offers to fix it: a task that is not published, a camera that is off,
        recognition set to answer for you. If the list is empty it says{' '}
        <b>Ready to run</b>.
      </p>
      <p>
        While the task runs, the block being carried out is highlighted in the
        workspace, so you can always see where the robot is in your program.
        When it reaches one of your steps, the panel shows your message over the
        live view, tells you which way it is waiting for you to answer, and —
        for a gesture, a word or an object — shows what it is looking for beside
        what it can currently see. If those two do not match, that is what to
        act on.
      </p>
      <p>
        You can widen the panel by dragging its left edge, the same way you can
        drag Copilot&rsquo;s. Copilot folds away on its own while a task runs
        and comes back when it stops.
      </p>

      <h2>Simulation and the real arm</h2>
      <p>
        <b>Start simulation</b> runs the task on the on-screen robot. Nothing
        physical moves, so it is the safe way to see whether your task does what
        you meant.
      </p>
      <p>
        <b>Run on robot</b> runs it on the arm in the room. You are asked to
        confirm first, because it is a real movement that cannot be undone.
      </p>
      <p>
        The <b>Stop</b> button in the panel stops the task. It is not an
        emergency stop: the red <b>e-stop</b> on the teach pendant is always the
        fastest and the only certain way to stop the arm, whatever the screen is
        showing.
      </p>

      <h2>Copilot</h2>
      <p>
        Describe what you want in ordinary words —{' '}
        <i>
          &ldquo;pick up the blue tube and place it on the sample tray&rdquo;
        </i>{' '}
        — and Copilot proposes the blocks. You see the proposal before anything
        changes: press <b>Apply</b> to put it in the workspace, or <b>Cancel</b>{' '}
        to leave your work as it is. If you already have blocks there, applying
        replaces them and you are asked to confirm.
      </p>
      <p>
        You can also just ask it questions about the task you are building. It
        only knows the objects, places and skills that are in your library, so
        it works best when you call things by the names you see there.
      </p>
      <p>
        The sparkle button turns on <b>proactive analysis</b>: Copilot then
        reviews your workspace and points out problems without being asked.
      </p>

      <h2>Your library, and sharing</h2>
      <p>
        <b>Objects</b>, <b>Locations</b> and <b>Skills</b> in the left menu are
        the things your tasks refer to — a tube, the sample tray, a movement the
        robot has already been taught. They are the same items that appear in
        the blocks&rsquo; slots.
      </p>
      <p>
        A task you own is either <b>private</b> or <b>shared</b> with other
        users; the small icon on its card says which. A task someone else has
        shared with you shows their name on the card instead. You can open and
        run a shared task, but only its owner can change it.
      </p>
    </MainCard>
  )
}

export default Faq
