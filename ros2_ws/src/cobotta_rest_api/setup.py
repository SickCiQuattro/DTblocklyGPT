from setuptools import find_packages, setup

package_name = 'cobotta_rest_api'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='matteo',
    maintainer_email='m.rizzo009@studenti.unibs.it',
    description='Example of publisher/subscriber',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
               'flask_node = cobotta_rest_api.flask_node:main',
               'cobotta_node = cobotta_rest_api.cobotta_node:main',
               'polling_socket_node = cobotta_rest_api.polling_socket_node:main',
               'gazebo_node = cobotta_rest_api.gazebo_node:main',
        ],
    },
)