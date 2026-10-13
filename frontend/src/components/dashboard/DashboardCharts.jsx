import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { cashFlowPlot, axisMoney, bucketLabel } from '../../utils/dashboard';
import { formatINR } from '../../utils/transactions';
const colors = [
  '#83e5d5',
  '#a7a0d5',
  '#b8c88c',
  '#deb78e',
  '#89b3d0',
  '#c58fa9',
  '#b4c9c6',
  '#9caed2',
  '#d3c394',
  '#a4c38c',
  '#bcb2a8',
];
function FlowTooltip({ active, payload, grouping }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{bucketLabel(point.date, grouping)}</strong>
      <p>
        Income <b>{formatINR(point.incomeMinor)}</b>
      </p>
      <p>
        Expenses <b>{formatINR(point.expenseMinor)}</b>
      </p>
    </div>
  );
}
export function CashFlowChart({ summary }) {
  const { maximum, points } = cashFlowPlot(summary.cashFlow);
  return (
    <div
      className="cash-chart"
      role="img"
      aria-label={`Income and expense chart, ${summary.period.grouping} buckets in UTC. Exact values are available in the data table below.`}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={{ width: 600, height: 260 }}
      >
        <AreaChart
          data={points}
          margin={{ top: 15, right: 5, bottom: 0, left: 0 }}
          accessibilityLayer
        >
          <CartesianGrid stroke="#303846" vertical={false} strokeDasharray="3 5" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => bucketLabel(value, summary.period.grouping)}
            minTickGap={30}
            tick={{ fill: '#a6b3c5', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 10000]}
            ticks={maximum < 100 ? [0, 10000] : [0, 2500, 5000, 7500, 10000]}
            width={55}
            tickFormatter={(value) => axisMoney(maximum, value)}
            tick={{ fill: '#a6b3c5', fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<FlowTooltip grouping={summary.period.grouping} />} />
          <Area
            name="Income"
            type="linear"
            dataKey="incomePlot"
            stroke="#83e5d5"
            fill="#83e5d5"
            fillOpacity={0.06}
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            name="Expenses"
            type="linear"
            dataKey="expensePlot"
            stroke="#b7abd4"
            fill="#b7abd4"
            fillOpacity={0.04}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function SpendingChart({ spending }) {
  return (
    <div
      className="spending-chart"
      role="img"
      aria-label="Expense category shares. Exact totals and approximate percentages are listed below."
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={{ width: 240, height: 170 }}
      >
        <PieChart>
          <Pie
            data={spending}
            dataKey="shareBasisPoints"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={49}
            outerRadius={72}
            stroke="#171d28"
            strokeWidth={3}
            isAnimationActive={false}
          >
            {spending.map((row, index) => (
              <Cell key={row.category} fill={colors[index % colors.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
