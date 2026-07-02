'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Grid,
  Icon,
  Skeleton,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react';
import {
  MdAccountBalance,
  MdAddCircleOutline,
  MdBarChart,
  MdDescription,
  MdGavel,
  MdOutlineReceiptLong,
  MdPeople,
  MdShowChart,
  MdTrendingDown,
  MdTrendingUp,
  MdUploadFile,
} from 'react-icons/md';
import { RiRobot2Line } from 'react-icons/ri';
import { useAuth } from 'context/AuthContext';
import { supabase } from 'lib/supabase';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface JournalLine {
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  entry_date: string;
  description: string;
  total_amount: number;
  transaction_type: string;
  journal_lines?: JournalLine[];
}

interface KPIs {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  cashBalance: number;
  accountsReceivable: number;
  accountsPayable: number;
  gstPayable: number;
  gstReceivable: number;
}

interface MonthBucket {
  label: string;
  year: number;
  month: number;
  revenue: number;
  expense: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CARD_SHADOW = '0px 18px 40px rgba(112, 144, 176, 0.12)';
const TEXT_DARK = '#1B2559';
const TEXT_BODY = '#676C73';
const TEXT_MUTED = '#AEB2B9';
const BORDER = '#E3E5EA';
const PAGE_BG = '#FCFCFD';

const formatINR = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

function getLast6Months(): MonthBucket[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleString('default', { month: 'short' }),
      year: d.getFullYear(),
      month: d.getMonth(),
      revenue: 0,
      expense: 0,
    };
  });
}

function buildMonthlyBuckets(entries: JournalEntry[]): MonthBucket[] {
  const buckets = getLast6Months();
  entries.forEach((e) => {
    const d = new Date(e.entry_date);
    const b = buckets.find((x) => x.year === d.getFullYear() && x.month === d.getMonth());
    if (!b) return;
    if (e.transaction_type === 'income') b.revenue += e.total_amount ?? 0;
    else if (e.transaction_type === 'expense') b.expense += e.total_amount ?? 0;
  });
  return buckets;
}

// ─── Stat Card (Horizon style) ────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  isLoading,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  isLoading: boolean;
}) {
  return (
    <Box bg="white" borderRadius="20px" p={{ base: '18px 20px', md: '20px 24px' }} boxShadow={CARD_SHADOW}>
      <Flex justify="space-between" align="center" gap="12px">
        <Box flex="1" minW="0">
          <Text
            fontSize="xs"
            color={TEXT_MUTED}
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="0.7px"
            mb="10px"
          >
            {label}
          </Text>
          {isLoading ? (
            <Skeleton h="26px" w="90px" borderRadius="6px" />
          ) : (
            <Text fontSize="22px" fontWeight="800" color={TEXT_DARK} letterSpacing="-0.5px">
              {formatINR(value)}
            </Text>
          )}
        </Box>
        <Flex
          w="56px"
          h="56px"
          borderRadius="full"
          bg={iconBg}
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={icon} w="26px" h="26px" color={iconColor} />
        </Flex>
      </Flex>
    </Box>
  );
}

// ─── Quick Action Row ─────────────────────────────────────────────────────────

function QuickAction({
  label,
  icon,
  href,
  iconBg,
  iconColor,
}: {
  label: string;
  icon: React.ElementType;
  href: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <Flex
        align="center"
        gap="14px"
        p="13px 16px"
        borderRadius="12px"
        border="1px solid"
        borderColor={BORDER}
        bg="white"
        _hover={{ bg: PAGE_BG, borderColor: '#51BC8F', transform: 'translateX(3px)' }}
        transition="all 0.16s"
        cursor="pointer"
      >
        <Flex
          w="38px"
          h="38px"
          borderRadius="10px"
          bg={iconBg}
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={icon} w="18px" h="18px" color={iconColor} />
        </Flex>
        <Text fontSize="sm" fontWeight="600" color={TEXT_DARK}>
          {label}
        </Text>
      </Flex>
    </Link>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [kpis, setKpis] = useState<KPIs>({
    totalRevenue: 0,
    totalExpenses: 0,
    netIncome: 0,
    cashBalance: 0,
    accountsReceivable: 0,
    accountsPayable: 0,
    gstPayable: 0,
    gstReceivable: 0,
  });
  const [monthlyData, setMonthlyData] = useState<MonthBucket[]>(getLast6Months());
  const [isLoading, setIsLoading] = useState(true);

  const name =
    (user?.user_metadata?.full_name as string) ||
    user?.email?.split('@')[0] ||
    'there';

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  useEffect(() => {
    if (!user) return;
    async function fetchData() {
      try {
        const { data } = await supabase
          .from('journal_entries')
          .select('id, entry_date, description, total_amount, transaction_type, journal_lines(account_name, account_type, debit, credit)')
          .eq('user_id', user!.id)
          .neq('status', 'void')
          .order('entry_date', { ascending: false })
          .limit(200);

        const all = (data as JournalEntry[]) ?? [];
        setEntries(all.slice(0, 10));

        const totalRevenue = all
          .filter((e) => e.transaction_type === 'income')
          .reduce((s, e) => s + (e.total_amount ?? 0), 0);
        const totalExpenses = all
          .filter((e) => e.transaction_type === 'expense')
          .reduce((s, e) => s + (e.total_amount ?? 0), 0);

        // Compute account balances from all journal lines
        const accBalance: Record<string, { type: string; debit: number; credit: number }> = {};
        all.forEach(entry => {
          (entry.journal_lines || []).forEach(line => {
            const name = line.account_name?.toLowerCase() || '';
            if (!accBalance[name]) accBalance[name] = { type: line.account_type, debit: 0, credit: 0 };
            accBalance[name].debit += line.debit || 0;
            accBalance[name].credit += line.credit || 0;
          });
        });

        // Cash Balance = sum of Cash in Hand + Bank Account balances (debit normal)
        let cashBalance = 0;
        Object.entries(accBalance).forEach(([name, v]) => {
          if (name.includes('cash') || name.includes('bank')) {
            cashBalance += v.debit - v.credit;
          }
        });

        // A/R = Accounts Receivable debit balance
        let accountsReceivable = 0;
        Object.entries(accBalance).forEach(([name, v]) => {
          if (name.includes('receivable')) {
            accountsReceivable += v.debit - v.credit;
          }
        });

        // A/P = Accounts Payable credit balance
        let accountsPayable = 0;
        Object.entries(accBalance).forEach(([name, v]) => {
          if (name.includes('payable') && !name.includes('gst') && !name.includes('tds')) {
            accountsPayable += v.credit - v.debit;
          }
        });

        // GST Payable = GST Payable accounts (net credit balance)
        let gstPayable = 0;
        Object.entries(accBalance).forEach(([name, v]) => {
          if (name.includes('gst payable') || name.includes('gst payable')) {
            gstPayable += v.credit - v.debit;
          }
        });

        // GST Receivable = GST Input Credit accounts (net debit balance)
        let gstReceivable = 0;
        Object.entries(accBalance).forEach(([name, v]) => {
          if (name.includes('gst input') || name.includes('input credit')) {
            gstReceivable += v.debit - v.credit;
          }
        });

        setKpis({
          totalRevenue,
          totalExpenses,
          netIncome: totalRevenue - totalExpenses,
          cashBalance: Math.max(0, cashBalance),
          accountsReceivable: Math.max(0, accountsReceivable),
          accountsPayable: Math.max(0, accountsPayable),
          gstPayable: Math.max(0, gstPayable),
          gstReceivable: Math.max(0, gstReceivable),
        });
        setMonthlyData(buildMonthlyBuckets(all));
      } catch {
        // table may not exist yet — show zeros
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [user]);

  // ── Chart configs ──────────────────────────────────────────────────────────

  const sharedChartProps: ApexCharts.ApexOptions = {
    chart: { toolbar: { show: false }, fontFamily: 'DM Sans, sans-serif' },
    xaxis: {
      categories: monthlyData.map((m) => m.label),
      labels: { style: { colors: TEXT_MUTED, fontSize: '12px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        formatter: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
        style: { colors: TEXT_MUTED, fontSize: '11px' },
      },
    },
    colors: ['#51BC8F', '#EE5D50'],
    dataLabels: { enabled: false },
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      labels: { colors: TEXT_BODY },
      markers: { radius: 4 } as any,
    },
    grid: { borderColor: BORDER, strokeDashArray: 4 },
    tooltip: { y: { formatter: (v) => formatINR(v) } },
  };

  const areaOptions: ApexCharts.ApexOptions = {
    ...sharedChartProps,
    chart: { ...sharedChartProps.chart, type: 'area' },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] },
    },
    stroke: { curve: 'smooth', width: 3 },
  };

  const barOptions: ApexCharts.ApexOptions = {
    ...sharedChartProps,
    chart: { ...sharedChartProps.chart, type: 'bar' },
    plotOptions: { bar: { borderRadius: 5, columnWidth: '58%' } },
  };

  const revenueSeries = [
    { name: 'Revenue', data: monthlyData.map((m) => m.revenue) },
    { name: 'Expenses', data: monthlyData.map((m) => m.expense) },
  ];

  // ── Table helpers ──────────────────────────────────────────────────────────

  const getDebitAcct = (e: JournalEntry) =>
    e.journal_lines?.find((l) => l.debit > 0)?.account_name ?? '—';

  const getCreditAcct = (e: JournalEntry) =>
    e.journal_lines?.find((l) => l.credit > 0)?.account_name ?? '—';

  const typeBadge = (type: string) => {
    if (type === 'income') return { bg: '#E6FAF5', color: '#01B574' };
    if (type === 'expense') return { bg: '#FEEFEE', color: '#EE5D50' };
    return { bg: '#F5F5F6', color: '#838589' };
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box bg={PAGE_BG} minH="100%" p={{ base: '16px', md: '28px' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Flex justify="space-between" align="flex-end" mb="28px" flexWrap="wrap" gap="8px">
        <Box>
          <Text fontSize="2xl" fontWeight="800" color={TEXT_DARK} letterSpacing="-0.6px">
            Welcome back, {name}
          </Text>
          <Text fontSize="sm" color={TEXT_MUTED} mt="2px">
            {today}
          </Text>
        </Box>
      </Flex>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <Grid
        templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }}
        gap="20px"
        mb="24px"
      >
        <StatCard
          label="Total Revenue"
          value={kpis.totalRevenue}
          icon={MdTrendingUp}
          iconBg="linear-gradient(135deg, #E6FAF5 0%, #B3E3CC 100%)"
          iconColor="#51BC8F"
          isLoading={isLoading}
        />
        <StatCard
          label="Total Expenses"
          value={kpis.totalExpenses}
          icon={MdTrendingDown}
          iconBg="linear-gradient(135deg, #FEEFEE 0%, #FECACA 100%)"
          iconColor="#EE5D50"
          isLoading={isLoading}
        />
        <StatCard
          label="Net Income"
          value={kpis.netIncome}
          icon={MdShowChart}
          iconBg="linear-gradient(135deg, #EFF4FB 0%, #C7D7F4 100%)"
          iconColor="#3965FF"
          isLoading={isLoading}
        />
        <StatCard
          label="Cash Balance"
          value={kpis.cashBalance}
          icon={MdAccountBalance}
          iconBg="linear-gradient(135deg, #F5F5F6 0%, #E3E5EA 100%)"
          iconColor="#838589"
          isLoading={isLoading}
        />
        <StatCard
          label="A/R Outstanding"
          value={kpis.accountsReceivable}
          icon={MdOutlineReceiptLong}
          iconBg="linear-gradient(135deg, #FFF6DA 0%, #FFE08A 100%)"
          iconColor="#FFB547"
          isLoading={isLoading}
        />
        <StatCard
          label="A/P Outstanding"
          value={kpis.accountsPayable}
          icon={MdDescription}
          iconBg="linear-gradient(135deg, #F2EFFF 0%, #D5CCFF 100%)"
          iconColor="#7551FF"
          isLoading={isLoading}
        />
      </Grid>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <Grid
        templateColumns={{ base: '1fr', lg: 'repeat(2, 1fr)' }}
        gap="20px"
        mb="24px"
      >
        <Box bg="white" borderRadius="20px" p="24px" boxShadow={CARD_SHADOW}>
          <Text fontWeight="700" fontSize="md" color={TEXT_DARK} mb="2px">
            Revenue vs Expenses
          </Text>
          <Text fontSize="xs" color={TEXT_MUTED} mb="20px">
            Last 6 months — trend view
          </Text>
          {isLoading ? (
            <Skeleton h="260px" borderRadius="12px" />
          ) : (
            <Chart options={areaOptions} series={revenueSeries} type="area" height={260} width="100%" />
          )}
        </Box>

        <Box bg="white" borderRadius="20px" p="24px" boxShadow={CARD_SHADOW}>
          <Text fontWeight="700" fontSize="md" color={TEXT_DARK} mb="2px">
            Monthly Comparison
          </Text>
          <Text fontSize="xs" color={TEXT_MUTED} mb="20px">
            Last 6 months — bar view
          </Text>
          {isLoading ? (
            <Skeleton h="260px" borderRadius="12px" />
          ) : (
            <Chart options={barOptions} series={revenueSeries} type="bar" height={260} width="100%" />
          )}
        </Box>
      </Grid>

      {/* ── GST Summary Widget ─────────────────────────────────────────────── */}
      <Box bg="white" borderRadius="20px" p="24px" boxShadow={CARD_SHADOW} mb="24px">
        <Flex justify="space-between" align="center" mb="16px" flexWrap="wrap" gap="8px">
          <Box>
            <Text fontWeight="700" fontSize="md" color={TEXT_DARK} mb="2px">GST Summary</Text>
            <Text fontSize="xs" color={TEXT_MUTED}>Current financial year position</Text>
          </Box>
          <Link href="/app/tax" style={{ textDecoration: 'none' }}>
            <Box fontSize="xs" fontWeight="600" color="#155740" cursor="pointer"
              px="12px" py="6px" bg="#E6FAF5" borderRadius="8px"
              _hover={{ bg: '#B3E3CC' }}>View Tax Details →</Box>
          </Link>
        </Flex>
        <Grid templateColumns={{ base: '1fr', sm: 'repeat(3, 1fr)' }} gap="16px">
          {[
            { label: 'GST Input Credit', value: kpis.gstReceivable, color: '#01B574', bg: 'linear-gradient(135deg,#E6FAF5,#B3E3CC)', desc: 'Claimable from purchases' },
            { label: 'GST Output Liability', value: kpis.gstPayable, color: '#EE5D50', bg: 'linear-gradient(135deg,#FEEFEE,#FECACA)', desc: 'Payable to government' },
            { label: 'Net GST Position', value: kpis.gstReceivable - kpis.gstPayable, color: kpis.gstReceivable >= kpis.gstPayable ? '#01B574' : '#EE5D50', bg: 'linear-gradient(135deg,#F5F5F6,#E3E5EA)', desc: kpis.gstReceivable >= kpis.gstPayable ? 'Input > Output (refund eligible)' : 'Net payable to govt' },
          ].map(({ label, value, color, bg, desc }) => (
            <Box key={label} p="18px" bg={PAGE_BG} borderRadius="14px" border="1px solid" borderColor={BORDER}>
              <Text fontSize="10px" fontWeight="700" color={TEXT_MUTED} textTransform="uppercase" letterSpacing="0.5px" mb="8px">{label}</Text>
              {isLoading ? <Skeleton h="22px" w="80px" mb="4px" /> : (
                <Text fontSize="xl" fontWeight="800" color={color} fontFamily="mono" mb="4px">
                  {Math.abs(value) < 1 ? '₹0' : formatINR(Math.abs(value))}
                </Text>
              )}
              <Text fontSize="10px" color={TEXT_MUTED}>{desc}</Text>
            </Box>
          ))}
        </Grid>
      </Box>

      {/* ── Table + Quick Actions ───────────────────────────────────────────── */}
      <Grid
        templateColumns={{ base: '1fr', xl: '1fr 280px' }}
        gap="20px"
      >
        {/* Recent Journal Entries */}
        <Box bg="white" borderRadius="20px" boxShadow={CARD_SHADOW} overflow="hidden">
          <Flex px="24px" pt="22px" pb="16px" justify="space-between" align="center">
            <Box>
              <Text fontWeight="700" fontSize="md" color={TEXT_DARK}>
                Recent Journal Entries
              </Text>
              <Text fontSize="xs" color={TEXT_MUTED} mt="2px">
                Last 10 AI-recorded entries
              </Text>
            </Box>
            <Link href="/app/journal">
              <Button
                size="sm"
                variant="ghost"
                color="#51BC8F"
                fontWeight="600"
                fontSize="sm"
                _hover={{ bg: '#E6FAF5' }}
                borderRadius="8px"
              >
                View All
              </Button>
            </Link>
          </Flex>

          {isLoading ? (
            <Box px="24px" pb="24px">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} h="48px" mb="8px" borderRadius="10px" />
              ))}
            </Box>
          ) : entries.length === 0 ? (
            <Flex direction="column" align="center" py="52px" px="24px" gap="12px">
              <Flex
                w="48px"
                h="48px"
                bg="#F5F5F6"
                borderRadius="14px"
                align="center"
                justify="center"
              >
                <Icon as={MdDescription} w="24px" h="24px" color={TEXT_MUTED} />
              </Flex>
              <Text fontSize="sm" color={TEXT_BODY} textAlign="center" maxW="280px">
                No transactions yet.{' '}
                <Link href="/app/ai-assistant">
                  <Text as="span" color="#51BC8F" fontWeight="600" cursor="pointer">
                    Chat with AI
                  </Text>
                </Link>{' '}
                to record your first journal entry.
              </Text>
            </Flex>
          ) : (
            <Box overflowX="auto">
              <Table size="sm" variant="simple">
                <Thead>
                  <Tr bg={PAGE_BG}>
                    {[
                      { label: 'Date', px: '24px', numeric: false },
                      { label: 'Description', px: '12px', numeric: false },
                      { label: 'Debit Account', px: '12px', numeric: false },
                      { label: 'Credit Account', px: '12px', numeric: false },
                      { label: 'Amount', px: '24px', numeric: true },
                      { label: 'Source', px: '16px', numeric: false },
                    ].map(({ label, px, numeric }) => (
                      <Th
                        key={label}
                        px={px}
                        isNumeric={numeric}
                        fontSize="10px"
                        color={TEXT_MUTED}
                        fontWeight="700"
                        letterSpacing="0.7px"
                        borderColor={BORDER}
                        textTransform="uppercase"
                        py="14px"
                        whiteSpace="nowrap"
                      >
                        {label}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {entries.map((e) => {
                    const badge = typeBadge(e.transaction_type);
                    return (
                      <Tr key={e.id} _hover={{ bg: PAGE_BG }}>
                        <Td px="24px" borderColor={BORDER} py="14px">
                          <Text fontSize="xs" color={TEXT_BODY} fontFamily="mono" whiteSpace="nowrap">
                            {new Date(e.entry_date).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </Text>
                        </Td>
                        <Td borderColor={BORDER} px="12px" maxW="180px">
                          <Text fontSize="sm" color={TEXT_DARK} fontWeight="500" noOfLines={1}>
                            {e.description}
                          </Text>
                        </Td>
                        <Td borderColor={BORDER} px="12px" maxW="140px">
                          <Text fontSize="xs" color={TEXT_BODY} noOfLines={1}>
                            {getDebitAcct(e)}
                          </Text>
                        </Td>
                        <Td borderColor={BORDER} px="12px" maxW="140px">
                          <Text fontSize="xs" color={TEXT_BODY} noOfLines={1}>
                            {getCreditAcct(e)}
                          </Text>
                        </Td>
                        <Td isNumeric px="24px" borderColor={BORDER}>
                          <Text
                            fontSize="sm"
                            fontWeight="700"
                            fontFamily="mono"
                            color={badge.color}
                            whiteSpace="nowrap"
                          >
                            {e.transaction_type === 'expense' ? '−' : '+'}
                            {formatINR(e.total_amount ?? 0)}
                          </Text>
                        </Td>
                        <Td borderColor={BORDER} px="16px">
                          <Flex
                            display="inline-flex"
                            align="center"
                            gap="4px"
                            px="8px"
                            py="3px"
                            bg="#E6FAF5"
                            borderRadius="6px"
                          >
                            <Icon as={RiRobot2Line} w="10px" h="10px" color="#51BC8F" />
                            <Text fontSize="10px" color="#51BC8F" fontWeight="700">
                              AI
                            </Text>
                          </Flex>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </Box>
          )}
        </Box>

        {/* Quick Actions */}
        <Box bg="white" borderRadius="20px" p="24px" boxShadow={CARD_SHADOW}>
          <Text fontWeight="700" fontSize="md" color={TEXT_DARK} mb="4px">
            Quick Actions
          </Text>
          <Text fontSize="xs" color={TEXT_MUTED} mb="20px">
            Jump to common tasks
          </Text>
          <Flex direction="column" gap="10px">
            <QuickAction
              label="Chat with AI"
              icon={RiRobot2Line}
              href="/app/ai-assistant"
              iconBg="#E6FAF5"
              iconColor="#51BC8F"
            />
            <QuickAction
              label="Add Invoice"
              icon={MdAddCircleOutline}
              href="/app/invoices?create=1"
              iconBg="#E6FAF5"
              iconColor="#51BC8F"
            />
            <QuickAction
              label="Upload Invoice"
              icon={MdUploadFile}
              href="/app/invoices"
              iconBg="#EFF4FB"
              iconColor="#3965FF"
            />
            <QuickAction
              label="Add Transaction"
              icon={MdAddCircleOutline}
              href="/app/journal"
              iconBg="#F2EFFF"
              iconColor="#7551FF"
            />
            <QuickAction
              label="View Reports"
              icon={MdBarChart}
              href="/app/reports"
              iconBg="#FFF6DA"
              iconColor="#FFB547"
            />
            <QuickAction
              label="Customers & Vendors"
              icon={MdPeople}
              href="/app/parties"
              iconBg="#FFF0F0"
              iconColor="#EE5D50"
            />
            <QuickAction
              label="GST & Tax"
              icon={MdGavel}
              href="/app/tax"
              iconBg="#F2EFFF"
              iconColor="#7551FF"
            />
          </Flex>
        </Box>
      </Grid>
    </Box>
  );
}
