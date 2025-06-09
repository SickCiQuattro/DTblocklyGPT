import React, { useState } from 'react'
import {
  Popconfirm,
  TableColumnsType,
  TablePaginationConfig,
  Space,
  Table,
  Spin,
  Modal,
} from 'antd'
import { useDispatch } from 'react-redux'
import { Button, IconButton, Stack } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'react-toastify'
import {
  EyeOutlined,
  PlayCircleOutlined,
  PlusCircleOutlined,
  IssuesCloseOutlined,
} from '@ant-design/icons'

import { MainCard } from 'components/MainCard'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem, openDrawer } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { iconMap } from 'utils/iconMap'
import {
  defaultCurrentPage,
  defaultPageSizeSelection,
  defaultPaginationConfig,
} from 'utils/constants'
import { formatDateTimeFrontend } from 'utils/date'
import { getFromLocalStorage } from 'utils/localStorageUtils'
import { MyRobotType } from 'pages/myrobots/types'
import { RunTaskModal } from './runTaskModal'
import { TaskType } from './types'
import { SimulateTaskModal } from './simulateTaskModal'
import { analyzeAbstractTask, AnalyzerIssue } from 'utils/taskAnalyzer'
import { blocklyToAbstract } from 'utils/blocklyParser'
import { ObjectListType } from 'pages/objects/types'
import { LocationListType } from 'pages/locations/types'
import { ActionListType } from 'pages/actions/types'
import { AnalyzeTaskModal } from './analyzeTaskModal'

const ListTasks = () => {
  const [tablePageSize, setTablePageSize] = useState(defaultPageSizeSelection)
  const [tableCurrentPage, setTableCurrentPage] = useState(defaultCurrentPage)
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const {
    data: dataTasks,
    mutate,
    isLoading: isLoadingTasks,
  } = useSWR<TaskType[], Error>({ url: endpoints.home.libraries.tasks })
  const { data: dataMyRobots, isLoading: isLoadingMyRobots } = useSWR<
    MyRobotType[],
    Error
  >({ url: endpoints.home.libraries.myRobots })
  const [runTaskModalVisible, setRunTaskModalVisible] = useState(false)
  const [runningTask, setRunningTask] = useState<TaskType | null>(null)
  const [simulateTaskModalVisible, setSimulateTaskModalVisible] =
    useState(false)
  const [simulatingTask, setSimulatingTask] = useState<TaskType | null>(null)
  const [analyzeModalVisible, setAnalyzeModalVisible] = useState(false)
  const [analyzeResults, setAnalyzeResults] = useState<AnalyzerIssue[] | null>(
    null,
  )
  const [analyzingTask, setAnalyzingTask] = useState<TaskType | null>(null)
  const { data: allObjects } = useSWR<ObjectListType[]>({
    url: endpoints.home.libraries.objects,
  })
  const { data: allLocations } = useSWR<LocationListType[]>({
    url: endpoints.home.libraries.locations,
  })
  const { data: allActions } = useSWR<ActionListType[]>({
    url: endpoints.home.libraries.actions,
  })

  const handleDetail = (id: number) => {
    dispatch(activeItem(''))
    navigate(`/task/${id}`)
  }

  const handleEdit = (id: number) => {
    dispatch(openDrawer(false))
    dispatch(activeItem('definegraphic'))
    navigate(`/graphic/${id}`)
  }

  const handleDelete = (id: number) => {
    fetchApi({
      url: endpoints.home.libraries.task,
      method: MethodHTTP.DELETE,
      body: { id },
    }).then(() => {
      toast.success(MessageText.success)
      mutate()
      if (dataTasks?.length === 1 && tableCurrentPage > 1) {
        setTableCurrentPage(tableCurrentPage - 1)
      }
    })
  }

  const handleAnalyze = async (task: TaskType) => {
    // Always fetch the task detail to get the code property
    try {
      const detail = await fetchApi({
        url: endpoints.home.libraries.task + `?id=${task.id}`,
        method: MethodHTTP.GET,
      })
      const code = detail?.code
      if (!code) {
        toast.error('No task code found for analysis')
        return
      }
      const blockly = typeof code === 'string' ? JSON.parse(code) : code
      const abstract: any = blocklyToAbstract(blockly)
      // Map objects, locations, actions to analyzer types
      abstract.objects =
        allObjects?.map((obj) => ({
          id: obj.id.toString(),
          name: obj.name,
          // @ts-expect-error: weight may exist in backend data
          weight: obj.weight ?? undefined,
          // @ts-expect-error: dimensions may exist in backend data
          dimensions: obj.dimensions ?? undefined,
        })) || []
      abstract.locations =
        allLocations?.map((loc) => ({
          id: loc.id.toString(),
          name: loc.name,
          // @ts-expect-error: distance may exist in backend data
          distance: loc.distance ?? undefined,
        })) || []
      abstract.actions =
        allActions?.map((act) => ({ id: act.id.toString(), name: act.name })) ||
        []
      // Optionally, add robot info if available
      const results = analyzeAbstractTask(abstract)
      setAnalyzeResults(results)
      setAnalyzingTask(task)
      setAnalyzeModalVisible(true)
    } catch (e) {
      toast.error('Failed to analyze task')
    }
  }

  const columns: TableColumnsType<TaskType> = [
    {
      key: 'detail',
      title: 'Detail',
      dataIndex: 'detail',
      width: 50,
      render: (_, record) => (
        <IconButton
          onClick={() => handleDetail(record.id)}
          color="primary"
          aria-label="detail"
          title="View task details"
          disabled={record.owner !== getFromLocalStorage('user')?.id}
        >
          <EyeOutlined style={{ fontSize: '2em' }} />
        </IconButton>
      ),
    },
    {
      key: 'run',
      title: 'Run',
      dataIndex: 'run',
      width: 50,
      render: (_, record) => (
        <IconButton
          onClick={() => {
            setRunTaskModalVisible(true)
            setRunningTask(record)
          }}
          color="primary"
          aria-label="detail"
          title="Run task"
        >
          <PlayCircleOutlined style={{ fontSize: '2em' }} />
        </IconButton>
      ),
    },
    {
      key: 'simulate',
      title: 'Simulate',
      dataIndex: 'simulate',
      width: 50,
      render: (_, record) => (
        <IconButton
          onClick={() => {
            setSimulateTaskModalVisible(true)
            setSimulatingTask(record)
          }}
          color="primary"
          aria-label="detail"
          title="Simulate task"
        >
          <IssuesCloseOutlined style={{ fontSize: '2em' }} />
        </IconButton>
      ),
    },
    { key: 'name', title: 'Name', dataIndex: 'name' },
    { key: 'description', title: 'Description', dataIndex: 'description' },
    { key: 'owner__username', title: 'Owner', dataIndex: 'owner__username' },
    {
      key: 'shared',
      title: 'Shared',
      dataIndex: 'shared',
      render: (shared) => {
        if (shared > 0) {
          return iconMap.successData
        }
        return iconMap.deleteCircle
      },
    },
    {
      key: 'last_modified',
      title: 'Last modified',
      dataIndex: 'last_modified',
      render: (_, record) => formatDateTimeFrontend(record.last_modified),
    },
    {
      title: 'Operations',
      key: 'operation',
      render: (_, record) => (
        <Space size="middle">
          <Button
            onClick={() => handleEdit(record.id)}
            disabled={record.owner !== getFromLocalStorage('user')?.id}
            title="Go to graphic interface"
          >
            Graphic
          </Button>
          <Button
            onClick={() => handleAnalyze(record)}
            title="Analyze this task for errors"
          >
            Analyze
          </Button>
          <Popconfirm
            title="Delete?"
            onConfirm={() => handleDelete(record.id)}
            okText="Ok"
            cancelText="Cancel"
            icon={iconMap.deleteCircle}
          >
            <Button
              color="error"
              disabled={record.owner !== getFromLocalStorage('user')?.id}
              title="Delete this task"
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const PaginationConfig: TablePaginationConfig = {
    pageSize: tablePageSize,
    current: tableCurrentPage,
    total: dataTasks?.length || 0,
    onChange: (page: number, pageSize: number) => {
      setTableCurrentPage(page)
      setTablePageSize(pageSize)
    },
    ...defaultPaginationConfig,
  }

  const handleAdd = () => {
    dispatch(activeItem('homepage'))
    navigate('/')
  }

  return (
    <MainCard
      title="Task list"
      subtitle="Here you can see the list of the defined tasks."
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 2, sm: 2, md: 2 }}
        sx={{ mb: 2, display: 'flex', justifyContent: 'space-between' }}
      >
        <Button
          size="large"
          variant="text"
          color="primary"
          onClick={handleAdd}
          startIcon={<PlusCircleOutlined />}
          title="Add a new task"
        >
          Add
        </Button>
      </Stack>
      <Table
        columns={columns}
        dataSource={dataTasks || []}
        pagination={PaginationConfig}
        loading={isLoadingTasks || isLoadingMyRobots}
        rowKey="id"
        style={{ overflowX: 'auto' }}
      />
      <RunTaskModal
        task={runningTask}
        dataMyRobots={dataMyRobots || []}
        open={runTaskModalVisible}
        handleClose={() => setRunTaskModalVisible(false)}
      />
      <SimulateTaskModal
        task={simulatingTask}
        open={simulateTaskModalVisible}
        handleClose={() => setSimulateTaskModalVisible(false)}
      />
      <AnalyzeTaskModal
        analyzingTask={analyzingTask}
        analyzeModalVisible={analyzeModalVisible}
        setAnalyzeModalVisible={setAnalyzeModalVisible}
        analyzeResults={analyzeResults}
      />
    </MainCard>
  )
}

export default ListTasks
