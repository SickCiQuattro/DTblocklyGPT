# :robot: blocklyGPT

This repository contains the prototype implementation of the project described in the [paper](https://dl.acm.org/doi/abs/10.1145/3610978.3640653).

> Gargioni, Luigi and Fogli, Daniela.
> "Integrating ChatGPT with Blockly for End-User Development of Robot Tasks"  
> *Companion of the 2024 ACM/IEEE International Conference on Human-Robot Interaction*, pages 478--482, 2024.  
> Publisher: ACM New York, NY.

## Citation

If you use this project in your research, please cite the following paper:

```bibtex
@inproceedings{gargioni2024integrating,
  title={Integrating ChatGPT with Blockly for End-User Development of Robot Tasks},
  author={Gargioni, Luigi and Fogli, Daniela},
  booktitle={Companion of the 2024 ACM/IEEE International Conference on Human-Robot Interaction},
  pages={478--482},
  year={2024}
}
```

## [Integrating ChatGPT with Blockly for End-User Development of Robot Tasks](https://dl.acm.org/doi/abs/10.1145/3610978.3640653)

This paper presents an End-User Development environment for collaborative robot programming, which integrates Open AI ChatGPT with Google Blockly. Within this environment, a user, who is neither expert in robotics nor in computer programming, can define the items characterizing the application domain (e.g., objects, actions, and locations) and define pick-and-place tasks involving these items. Task definition can be achieved with a combination of natural language and block-based interaction, which exploits the computational capabilities of ChatGPT and the graphical interaction features offered by Blockly, to check the correctness of generated robot programs and modify them through direct manipulation.

---

## :gear: BackEnd

* Default Port: ```8000```

---

### :dart: Requirements

* [Python 3.11.x](https://www.python.org/downloads/)
* [Poetry](https://python-poetry.org/docs/#installation) (pip installation is not the official one, but the easiest)

---

### :star2: Installing from scratch

```bash
poetry install
```

---

### :wrench: Start server

```bash
poetry run start
```

---

### :arrows_counterclockwise: Update dependencies

Update with versions from `pyproject.toml`:

```bash
poetry update
```

\
Update `pyproject.toml` with latest versions retrieved from internet:

```bash
poetry run poetryup
```

---

## :dizzy: FrontEnd

* Folder: ```src```

---

### :books: Design libraries

* [React 18.x.x](https://it.reactjs.org/)
* [Parcel](https://parceljs.org/)
* [Ant Design](https://ant.design/)

---

### :open_file_folder: Install dependencies

```bash
npm install
```

---

### :twisted_rightwards_arrows: Update dependencies in package.json

* Visual Studio Code Exstension: [Versions Lens](https://marketplace.visualstudio.com/items?itemName=pflannery.vscode-versionlens)

---

### :mag_right: Start debug server

```bash
npm start
```

## :key: Credentials

* Username: `operator1`  
Password: `Operator_1!`  
Type: `Operator`  

* Username: `manager1`  
Password: `passwordmanager1`  
Type: `Manager`  

### For Django admin panel "127.0.0.1:8000/admin/":
* Username: `admin`  
Password: `adminpassword`  
Type: `Administrator`/`Manager`

## Gazebo
```bash
ign gazebo -v 4 worldCobotta.sdf
```