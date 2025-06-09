import React, { useState } from 'react'
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
import { EyeOutlined, PlusCircleOutlined } from '@ant-design/icons'

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
import { formatDateTimeFrontend } from 'utils/date'
import { UserListType } from './types'

const ListUsers = () => {
  const [tablePageSize, setTablePageSize] = useState(defaultPageSizeSelection)
  const [tableCurrentPage, setTableCurrentPage] = useState(defaultCurrentPage)
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const { data, mutate, isLoading } = useSWR<UserListType[], Error>({
    url: endpoints.home.management.users,
  })

  const handleDetail = (id: number) => {
    dispatch(activeItem(''))
    navigate(`/user/${id}`)
  }

  const handleDisable = (id: number, updatedActive: boolean) => {
    fetchApi({
      url: endpoints.home.management.user,
      method: MethodHTTP.DELETE,
      body: {
        id,
        active: updatedActive,
      },
    }).then(() => {
      toast.success(MessageText.success)
      mutate()
    })
  }

  const handleResetPassword = (id: number) => {
    fetchApi({
      url: endpoints.home.management.resetPassword,
      method: MethodHTTP.POST,
      body: {
        id,
      },
    }).then(() => toast.success(MessageText.success))
  }

  const columns: TableColumnsType<UserListType> = [
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
          title="View user details"
        >
          <EyeOutlined style={{ fontSize: '2em' }} />
        </IconButton>
      ),
    },
    {
      key: 'username',
      title: 'Username',
      dataIndex: 'username',
    },
    {
      key: 'email',
      title: 'Email',
      dataIndex: 'email',
    },
    {
      key: 'role',
      title: 'Role',
      dataIndex: 'role',
    },
    {
      key: 'last_login',
      title: 'Last login',
      dataIndex: 'last_login',
      render: (_, record) => formatDateTimeFrontend(record.last_login),
    },
    {
      key: 'date_joined',
      title: 'Date joined',
      dataIndex: 'date_joined',
      render: (_, record) => formatDateTimeFrontend(record.date_joined),
    },
    {
      key: 'is_active',
      title: 'Active',
      dataIndex: 'is_active',
      render: (active) => {
        if (active > 0) {
          return iconMap.successData
        }
        return iconMap.deleteCircle
      },
    },
    {
      title: 'Operations',
      key: 'operation',
      render: (_, record) => (
        <Space size="middle">
          <Popconfirm
            title="Reset password?"
            onConfirm={() => handleResetPassword(record.id)}
            okText="Ok"
            cancelText="Cancel"
            icon={iconMap.deleteCircle}
          >
            <Button title="Reset user password">Reset password</Button>
          </Popconfirm>
          <Popconfirm
            title={record.is_active ? 'Disable?' : 'Enable?'}
            onConfirm={() => handleDisable(record.id, !record.is_active)}
            okText="Ok"
            cancelText="Cancel"
            icon={iconMap.deleteCircle}
          >
            <Button
              color={record.is_active ? 'error' : 'primary'}
              title={
                record.is_active ? 'Disable this user' : 'Enable this user'
              }
            >
              {record.is_active ? 'Disable' : 'Enable'}
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
    navigate('/user/add')
  }

  return (
    <MainCard
      title="User list"
      subtitle="Here you can see the list of the defined Users."
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
          title="Add a new user"
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
    </MainCard>
  )
}

export default ListUsers
