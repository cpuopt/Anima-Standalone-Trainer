# 事实与边界

2026-11-15 核实：https://www.tensorflow.org/tensorboard/get_started 。TensorBoard支持标量指标观察，曲线与筛选保留在原生嵌入页中。
布局参照核实：https://grafana.com/docs/grafana/latest/visualizations/dashboards/use-dashboards/ 。仅借用观察界面工具条与图表优先的主从关系，不引入Grafana功能。

本项目源码：TensorBoardPanel.vue 提供服务status、launch、stop和iframe；editor.ts提供name、architecture、running等任务信息。现有左侧提示说明Anima日志在logs/，Krea 2在output/tensorboard/。MOSS的具体日志位置在选定实现时按服务端实际返回核实，不猜测。

原型使用演示任务与数据。未读取真实训练指标，未声称实测性能或新后端能力。
