import React from 'react'

import { defaultPath } from 'utils/constants'
import './index.css'

const PageNotFound = () => (
  <div id="pageNotFoundBody">
    <section id="not-found">
      <div id="title">
        <a id="title-link" href={defaultPath}>
          Back
        </a>
      </div>
      <div className="circles">
        <p>
          404
          <br />
          <small>Page not found</small>
        </p>
        <span className="circle big" />
        <span className="circle med" />
        <span className="circle small" />
      </div>
    </section>
  </div>
)

export default PageNotFound
