import { safeReply } from '../../utils/safeReply';
import { Message, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import Game from '../../models/Game';
import { betterEmbed } from '../../utils/betterembed';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

const DURATIONS = [
  { label: '1 Day', value: '1d', days: 1 },
  { label: '3 Days', value: '3d', days: 3 },
  { label: '7 Days', value: '7d', days: 7 },
  { label: '14 Days', value: '14d', days: 14 },
  { label: '30 Days', value: '30d', days: 30 },
];

export async function gamescount(interaction: Message | ChatInputCommandInteraction) {
  let selectedDuration = '30d';

  function getStartDate(duration: string) {
    const days = DURATIONS.find(d => d.value === duration)?.days || 7;
    const d = new Date();
    d.setDate(d.getDate() - days + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async function getGameCounts(duration: string) {
    const startDate = getStartDate(duration);
    const days = DURATIONS.find(d => d.value === duration)?.days || 7;
    const keys: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      keys.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    const games = await Game.find({ startTime: { $gte: startDate } }).select('startTime state');
    const states = ['pending', 'voided', 'scored'];
    const counts: Record<string, Record<string, number>> = {};
    for (const state of states) {
      counts[state] = {};
      for (const key of keys) counts[state][key] = 0;
    }
    for (const game of games) {
      const d = new Date(game.startTime);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      if (counts[game.state] && counts[game.state][key] !== undefined) {
        counts[game.state][key]++;
      }
    }
    return { keys, counts };
  }

async function renderChart(keys: string[], counts: Record<string, Record<string, number>>) {
    const width = 1280;
    const height = 720;

    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
    
    const totalGames = keys.map(k => 
        (counts['pending'][k] || 0) + 
        (counts['voided'][k] || 0) + 
        (counts['scored'][k] || 0)
    );

    const datasets = [
        {
            label: 'Pending',
            data: keys.map(k => counts['pending'][k]),
            borderColor: '#FFD600',
            backgroundColor: 'rgba(255,214,0,0.1)',
            fill: false,
            tension: 0.4,
            type: 'line' as const,
        },
        {
            label: 'Voided',
            data: keys.map(k => counts['voided'][k]),
            borderColor: '#FF1744',
            backgroundColor: 'rgba(255,23,68,0.1)',
            fill: false,
            tension: 0.4,
            type: 'line' as const,
        },
        {
            label: 'Scored',
            data: keys.map(k => counts['scored'][k]),
            borderColor: '#00E676',
            backgroundColor: 'rgba(0,230,118,0.1)',
            fill: false,
            tension: 0.4,
            type: 'line' as const,
        },
        {
            label: 'Total Games',
            data: totalGames,
            type: 'bar' as const,
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: '#36A2EB',
            borderWidth: 2,
            fill: true,
        },
    ];

    const chartConfig = {
        type: 'bar' as const, 
        data: {
            labels: keys,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: true, labels: { color: '#fff' } },
                title: {
                    display: true,
                    text: `Games Count (last ${keys.length} days)`,
                    font: { size: 18 },
                    color: '#fff',
                },
                background: {
                    color: '#000',
                },
            },
            layout: {
                padding: 20,
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.45)' },
                    ticks: { color: 'rgba(255, 255, 255, 0.45)' },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.45)' },
                    ticks: { color: 'rgba(255, 255, 255, 0.45)' },
                },
            },
            backgroundColor: '#000',
        },
        plugins: [{
            id: 'customCanvasBackgroundColor',
            beforeDraw: (chart: any) => {
                const ctx = chart.ctx;
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, chart.width, chart.height);
                ctx.restore();
            }
        }],
    };
    return chartJSNodeCanvas.renderToBuffer(chartConfig);
}



  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('gamescount_duration')
    .setPlaceholder('Select Duration')
    .addOptions(DURATIONS.map(d => ({ label: d.label, value: d.value, default: d.value === selectedDuration })));
  const components = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)];

  const { keys, counts } = await getGameCounts(selectedDuration);
  const chartBuffer = await renderChart(keys, counts);
  const chartImage = `attachment://games_count_chart.png`;
  const embed = betterEmbed(
    undefined,
    '#00AAAA',
    'Games Count Chart'
  );
  embed.builder.setImage(chartImage);
  embed.builder.setTimestamp();

  let sentMsg;
  if (interaction instanceof ChatInputCommandInteraction) {
    sentMsg = await safeReply(interaction, { embeds: [embed.builder], files: [{ attachment: chartBuffer, name: 'games_count_chart.png' }], components, fetchReply: true });
  } else {
    sentMsg = await (interaction.channel as any).send({ embeds: [embed.builder], files: [{ attachment: chartBuffer, name: 'games_count_chart.png' }], components });
  }

  const collector = sentMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 5 * 60 * 1000 });
  collector.on('collect', async (i: any) => {
    if (i.user.id !== (interaction instanceof ChatInputCommandInteraction ? interaction.user.id : (interaction as Message).author.id)) {
      await safeReply(i, { content: 'You cannot interact with this menu.', ephemeral: true });
      return;
    }
    if (i.isStringSelectMenu && i.isStringSelectMenu() && i.customId === 'gamescount_duration') {
      selectedDuration = i.values[0];
      const { keys: newKeys, counts: newCounts } = await getGameCounts(selectedDuration);
      const newChartBuffer = await renderChart(newKeys, newCounts);
      const newEmbed = betterEmbed(
        undefined,
        '#00AAAA',
        'Games Count Chart'
      );
      newEmbed.builder.setImage('attachment://games_count_chart.png');
      newEmbed.builder.setTimestamp();
      await i.update({ embeds: [newEmbed.builder], files: [{ attachment: newChartBuffer, name: 'games_count_chart.png' }], components });
    }
  });
}