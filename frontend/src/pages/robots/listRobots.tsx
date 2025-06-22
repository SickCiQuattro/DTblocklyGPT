import React, { useRef, useState } from 'react'
import {
  Popconfirm,
  TableColumnsType,
  TablePaginationConfig,
  Space,
  Table,
} from 'antd'
import { useDispatch } from 'react-redux'
import { Button, IconButton, Stack } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'react-toastify'
import {
  EyeOutlined,
  PlusCircleOutlined,
  QrcodeOutlined,
} from '@ant-design/icons'

import { MainCard } from 'components/MainCard'
import { fetchApi, MethodHTTP } from 'services/api'
import { endpoints } from 'services/endpoints'
import { activeItem } from 'store/reducers/menu'
import { MessageText } from 'utils/messages'
import { iconMap } from 'utils/iconMap'
import {
  defaultCurrentPage,
  defaultPageSizeSelection,
  defaultPaginationConfig,
} from 'utils/constants'
import { QRCodeCanvas } from 'qrcode.react'
import { RobotModel, RobotType } from './types'

const ListRobots = () => {
  const [tablePageSize, setTablePageSize] = useState(defaultPageSizeSelection)
  const [tableCurrentPage, setTableCurrentPage] = useState(defaultCurrentPage)
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { data, mutate, isLoading } = useSWR<RobotType[], Error>({
    url: endpoints.home.management.robots,
  })
  const [qrCodeText, setQrCodeText] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

  const handleDetail = (id: number) => {
    dispatch(activeItem(''))
    navigate(`/robot/${id}`)
  }

  const handleDelete = (id: number) => {
    fetchApi({
      url: endpoints.home.management.robot,
      method: MethodHTTP.DELETE,
      body: {
        id,
      },
    }).then(() => {
      toast.success(MessageText.success)
      mutate()
      if (data?.length === 1 && tableCurrentPage > 1) {
        setTableCurrentPage(tableCurrentPage - 1)
      }
    })
  }

  const downloadQRCode = (id: number) => {
    /*
    setQrCodeText(id.toString())
    console.log(document.getElementById('qrCodeEl') as any)
    const qrCodeURL = (document.getElementById('qrCodeEl') as any)
      .toDataURL('image/png')
      .replace('image/png', 'image/octet-stream')
    const aEl = document.createElement('a')
    aEl.href = qrCodeURL
    aEl.download = `QR code robot with ID ${id}.png`
    document.body.appendChild(aEl)
    aEl.click()
    document.body.removeChild(aEl)
    */

    if (!canvasRef.current) return
    setQrCodeText(id.toString())
    const canvas = canvasRef.current.querySelector('canvas')
    if (!canvas) return
    const pngUrl = canvas
      .toDataURL('image/png')
      .replace('image/png', 'image/octet-stream')

    const downloadLink = document.createElement('a')
    downloadLink.href = pngUrl
    downloadLink.download = `robot-${id}-qrcode.png`
    downloadLink.click()
  }

  const columns: TableColumnsType<RobotType> = [
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
          title="View robot details"
        >
          <EyeOutlined style={{ fontSize: '2em' }} />
        </IconButton>
      ),
    },
    {
      key: 'qrcode',
      title: 'QR',
      dataIndex: 'qrcode',
      width: 50,
      render: (_, record) => (
        <IconButton
          onClick={() => downloadQRCode(record.id)}
          color="primary"
          aria-label="qrcode"
          title="Download QR Code"
        >
          <QrcodeOutlined style={{ fontSize: '2em' }} />
        </IconButton>
      ),
    },
    {
      key: 'name',
      title: 'Name',
      dataIndex: 'name',
    },
    {
      key: 'model',
      title: 'Model',
      dataIndex: 'model',
      render: (model) => RobotModel[model],
    },
    {
      key: 'ip',
      title: 'IP',
      dataIndex: 'ip',
    },
    {
      key: 'port',
      title: 'Port',
      dataIndex: 'port',
    },
    {
      key: 'cameraip',
      title: 'Camera IP',
      dataIndex: 'cameraip',
    },
    {
      title: 'Operations',
      key: 'operation',
      render: (_, record) => (
        <Space size="middle">
          <Popconfirm
            title="Delete?"
            onConfirm={() => handleDelete(record.id)}
            okText="Ok"
            cancelText="Cancel"
            icon={iconMap.deleteCircle}
          >
            <Button color="error" title="Delete this robot">
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
    total: data?.length || 0,
    onChange: (page: number, pageSize: number) => {
      setTableCurrentPage(page)
      setTablePageSize(pageSize)
    },
    ...defaultPaginationConfig,
  }

  const handleAdd = () => {
    dispatch(activeItem(''))
    navigate('/robot/add')
  }

  return (
    <MainCard
      title="Robot list"
      subtitle="Here you can see the list of the Robots defined at system level."
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
          title="Add a new robot"
        >
          Add
        </Button>
      </Stack>
      <Table
        columns={columns}
        dataSource={data || []}
        pagination={PaginationConfig}
        loading={isLoading}
        rowKey="id"
        style={{ overflowX: 'auto' }}
      />
      <div ref={canvasRef} style={{ display: 'none' }}>
        <QRCodeCanvas size={150} value={qrCodeText} />
      </div>
    </MainCard>
  )
}

export default ListRobots
