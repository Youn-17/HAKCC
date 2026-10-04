"""
Publication-quality research chart generator for HAKCC.
Accepts JSON data via stdin, outputs PNG to stdout.

Usage:
  echo '{"chart_type": "sna_network", "data": {...}}' | python3 research_charts.py

Supported chart types:
  - sna_network: Force-directed network graph
  - sna_centrality: Centrality distribution plots
  - lsa_heatmap: Transition matrix heatmap with significance
  - lsa_transitions: Significant transitions diagram
  - temporal_timeline: Activity timeline with annotations
  - temporal_momentum: Momentum & acceleration curves
  - temporal_rhythm: Circadian rhythm radar
  - discourse_levels: KB discourse level distribution
  - discourse_progression: Discourse quality over time
  - discourse_keywords: Keyword importance chart
  - equity_lorenz: Publication-quality Lorenz curve
  - equity_temporal: Gini coefficient over time
  - equity_palma: Palma ratio visualization
"""

import sys
import json
import io
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch
import matplotlib.patches as mpatches
from matplotlib.collections import LineCollection
import seaborn as sns
from scipy import stats as scipy_stats

# Publication style configuration
plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['Helvetica Neue', 'Arial', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
    'font.size': 10,
    'axes.titlesize': 12,
    'axes.labelsize': 10,
    'xtick.labelsize': 8,
    'ytick.labelsize': 8,
    'legend.fontsize': 9,
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.linewidth': 0.8,
    'grid.linewidth': 0.4,
    'grid.alpha': 0.3,
    'lines.linewidth': 1.5,
})

NAVY = '#000080'
NAVY_LIGHT = '#4169E1'
COLORS = ['#000080', '#2563eb', '#7c3aed', '#dc2626', '#059669', '#d97706', '#6366f1', '#ec4899']
GRAY = '#6b7280'


def output_png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)
    sys.stdout.buffer.write(buf.getvalue())


def chart_sna_network(data):
    nodes = data.get('nodes', [])
    edges = data.get('edges', [])
    if not nodes:
        return empty_chart('No network data')

    fig, ax = plt.subplots(1, 1, figsize=(8, 8))

    # Spring layout simulation
    n = len(nodes)
    node_ids = [nd['id'] for nd in nodes]
    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}

    # Initialize positions randomly
    np.random.seed(42)
    pos = np.random.randn(n, 2) * 2

    # Fruchterman-Reingold iterations
    k = np.sqrt(4.0 / max(n, 1))
    for _ in range(50):
        disp = np.zeros((n, 2))
        for i in range(n):
            delta = pos[i] - pos
            dist = np.maximum(np.sqrt((delta ** 2).sum(axis=1)), 0.01)
            # Repulsive force
            disp[i] += (delta / dist[:, None] * (k ** 2 / dist)[:, None]).sum(axis=0)
        # Attractive force
        for e in edges:
            si = id_to_idx.get(e.get('source'))
            ti = id_to_idx.get(e.get('target'))
            if si is None or ti is None:
                continue
            delta = pos[si] - pos[ti]
            dist = max(np.sqrt((delta ** 2).sum()), 0.01)
            force = dist ** 2 / k
            disp[si] -= delta / dist * force
            disp[ti] += delta / dist * force
        # Apply displacement with temperature
        temp = 1.0 / (_ + 1)
        disp_mag = np.maximum(np.sqrt((disp ** 2).sum(axis=1)), 0.01)
        pos += disp / disp_mag[:, None] * np.minimum(disp_mag, temp)[:, None]

    # Normalize positions
    pos -= pos.mean(axis=0)
    scale = pos.max() - pos.min()
    if scale > 0:
        pos = pos / scale * 3

    # Draw edges
    max_weight = max((e.get('weight', 1) for e in edges), default=1)
    for e in edges:
        si = id_to_idx.get(e.get('source'))
        ti = id_to_idx.get(e.get('target'))
        if si is None or ti is None:
            continue
        w = e.get('weight', 1) / max_weight
        ax.annotate('', xy=pos[ti], xytext=pos[si],
                    arrowprops=dict(arrowstyle='->', color=NAVY, alpha=0.15 + w * 0.4,
                                    lw=0.5 + w * 1.5, connectionstyle='arc3,rad=0.1'))

    # Draw nodes
    centralities = [nd.get('degreeCentrality', 0.1) for nd in nodes]
    max_c = max(centralities) if centralities else 1
    sizes = [200 + (c / max(max_c, 0.01)) * 800 for c in centralities]

    ax.scatter(pos[:, 0], pos[:, 1], s=sizes, c=NAVY, alpha=0.7, edgecolors='white', linewidths=1.5, zorder=5)

    # Labels for top nodes
    sorted_idx = sorted(range(n), key=lambda i: centralities[i], reverse=True)
    for i in sorted_idx[:min(10, n)]:
        ax.annotate(node_ids[i][:6], pos[i], fontsize=7, ha='center', va='bottom',
                    xytext=(0, 8), textcoords='offset points', color=GRAY)

    ax.set_xlim(pos[:, 0].min() - 0.5, pos[:, 0].max() + 0.5)
    ax.set_ylim(pos[:, 1].min() - 0.5, pos[:, 1].max() + 0.5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('Knowledge Building Interaction Network', fontsize=13, fontweight='bold', pad=15)

    # Stats annotation
    density = data.get('metrics', {}).get('density', 0)
    ax.text(0.02, 0.02, f'N={n}  E={len(edges)}  Density={density:.4f}',
            transform=ax.transAxes, fontsize=8, color=GRAY, va='bottom')

    output_png(fig)


def chart_sna_centrality(data):
    nodes = data.get('nodes', [])
    if not nodes:
        return empty_chart('No centrality data')

    fig, axes = plt.subplots(1, 3, figsize=(12, 4))

    metrics = [
        ('degreeCentrality', 'Degree Centrality'),
        ('betweennessCentrality', 'Betweenness Centrality'),
        ('eigenvector', 'Eigenvector Centrality'),
    ]

    for ax, (key, title) in zip(axes, metrics):
        values = [nd.get(key, 0) for nd in nodes]
        if not values or max(values) == 0:
            ax.text(0.5, 0.5, 'No data', ha='center', va='center', transform=ax.transAxes)
            ax.set_title(title)
            continue

        sns.histplot(values, bins=min(15, len(set(values))), ax=ax, color=NAVY, alpha=0.7, edgecolor='white')
        ax.axvline(np.mean(values), color='#dc2626', linestyle='--', linewidth=1, label=f'Mean={np.mean(values):.3f}')
        ax.set_title(title, fontweight='bold')
        ax.set_xlabel('Value')
        ax.set_ylabel('Count')
        ax.legend(fontsize=7)

    plt.tight_layout()
    output_png(fig)


def chart_lsa_heatmap(data):
    codes = data.get('codes', [])
    matrix = data.get('zScoreMatrix', data.get('adjustedResiduals', []))
    if not codes or not matrix:
        return empty_chart('No LSA data')

    n = min(len(codes), 12)
    codes = codes[:n]
    matrix = [row[:n] for row in matrix[:n]]

    fig, ax = plt.subplots(1, 1, figsize=(8, 7))

    arr = np.array(matrix)
    mask = np.abs(arr) < 1.96

    sns.heatmap(arr, annot=True, fmt='.2f', cmap='RdBu_r', center=0,
                xticklabels=codes, yticklabels=codes, ax=ax,
                linewidths=0.5, linecolor='white',
                cbar_kws={'label': 'Adjusted Residual (z-score)', 'shrink': 0.8},
                annot_kws={'size': 8})

    # Mark significant cells
    for i in range(n):
        for j in range(n):
            if abs(arr[i, j]) >= 1.96:
                ax.add_patch(plt.Rectangle((j, i), 1, 1, fill=False, edgecolor='black', linewidth=1.5))

    ax.set_title('Lag Sequential Analysis — Adjusted Residuals\n(|z| ≥ 1.96 highlighted)', fontsize=12, fontweight='bold')
    ax.set_xlabel('Target Behavior (t+lag)')
    ax.set_ylabel('Antecedent Behavior (t)')
    plt.xticks(rotation=45, ha='right')
    plt.yticks(rotation=0)

    plt.tight_layout()
    output_png(fig)


def chart_lsa_transitions(data):
    transitions = data.get('significantTransitions', [])
    if not transitions:
        return empty_chart('No significant transitions')

    fig, ax = plt.subplots(1, 1, figsize=(10, 6))

    # Sort by z-score magnitude
    transitions = sorted(transitions, key=lambda t: abs(t['zScore']), reverse=True)[:15]

    labels = [f"{t['from']} → {t['to']}" for t in transitions]
    z_scores = [t['zScore'] for t in transitions]
    colors_list = [('#059669' if z > 0 else '#dc2626') for z in z_scores]

    y_pos = np.arange(len(labels))
    bars = ax.barh(y_pos, z_scores, color=colors_list, alpha=0.8, edgecolor='white', height=0.7)

    ax.axvline(0, color=GRAY, linewidth=0.5)
    ax.axvline(1.96, color=GRAY, linewidth=0.5, linestyle='--', alpha=0.5)
    ax.axvline(-1.96, color=GRAY, linewidth=0.5, linestyle='--', alpha=0.5)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=9)
    ax.set_xlabel('Adjusted Residual (z-score)')
    ax.set_title('Significant Behavioral Transitions\n(Excitatory ↑ / Inhibitory ↓)', fontsize=12, fontweight='bold')

    # Add significance markers
    for i, (bar, t) in enumerate(zip(bars, transitions)):
        p = t.get('pValue', 1)
        marker = '***' if p <= 0.001 else '**' if p <= 0.01 else '*'
        ax.text(bar.get_width() + 0.1 * np.sign(bar.get_width()), i, marker, va='center', fontsize=8, color=GRAY)

    legend_elements = [
        mpatches.Patch(facecolor='#059669', alpha=0.8, label='Excitatory (above expected)'),
        mpatches.Patch(facecolor='#dc2626', alpha=0.8, label='Inhibitory (below expected)'),
    ]
    ax.legend(handles=legend_elements, loc='lower right', fontsize=8)

    plt.tight_layout()
    output_png(fig)


def chart_temporal_timeline(data):
    timeline = data.get('timeline', [])
    bursts = data.get('bursts', [])
    if not timeline:
        return empty_chart('No temporal data')

    fig, ax = plt.subplots(1, 1, figsize=(12, 5))

    dates = [t['date'] for t in timeline]
    notes = [t.get('notes', 0) for t in timeline]
    events = [t.get('events', 0) for t in timeline]
    relations = [t.get('relations', 0) for t in timeline]

    x = np.arange(len(dates))
    width = 0.8

    ax.bar(x, notes, width, label='Notes', color=NAVY, alpha=0.7)
    ax.bar(x, events, width, bottom=notes, label='Events', color=NAVY_LIGHT, alpha=0.5)
    ax.bar(x, relations, width, bottom=[n + e for n, e in zip(notes, events)], label='Relations', color='#7c3aed', alpha=0.4)

    # Mark bursts
    burst_dates = set(b['date'] for b in bursts)
    for i, d in enumerate(dates):
        if d in burst_dates:
            total = notes[i] + events[i] + relations[i]
            ax.annotate('★', (i, total), fontsize=10, ha='center', va='bottom', color='#d97706')

    # X-axis: show every nth date
    step = max(1, len(dates) // 12)
    ax.set_xticks(x[::step])
    ax.set_xticklabels([dates[i] for i in range(0, len(dates), step)], rotation=45, ha='right', fontsize=7)

    ax.set_xlabel('Date')
    ax.set_ylabel('Activity Count')
    ax.set_title('Knowledge Building Activity Timeline', fontsize=13, fontweight='bold')
    ax.legend(loc='upper right', framealpha=0.9)
    ax.grid(axis='y', alpha=0.3)

    if bursts:
        ax.text(0.02, 0.95, f'★ = Burst days ({len(bursts)} detected)', transform=ax.transAxes,
                fontsize=8, color='#d97706', va='top')

    plt.tight_layout()
    output_png(fig)


def chart_temporal_momentum(data):
    momentum = data.get('momentum', [])
    phases = data.get('phases', [])
    if not momentum:
        return empty_chart('No momentum data')

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7), sharex=True, gridspec_kw={'height_ratios': [2, 1]})

    dates = [m['date'] for m in momentum]
    rates = [m['rate'] for m in momentum]
    accels = [m['acceleration'] for m in momentum]
    x = np.arange(len(dates))

    # Rate plot
    ax1.plot(x, rates, color=NAVY, linewidth=2, label='Activity Rate (7-day MA)')
    ax1.fill_between(x, 0, rates, alpha=0.1, color=NAVY)
    ax1.axhline(np.mean(rates), color=GRAY, linestyle='--', linewidth=0.8, alpha=0.5, label=f'Mean = {np.mean(rates):.1f}')
    ax1.set_ylabel('Daily Activity Rate')
    ax1.set_title('Activity Momentum Analysis', fontsize=13, fontweight='bold')
    ax1.legend(loc='upper right', fontsize=8)
    ax1.grid(axis='y', alpha=0.3)

    # Phase annotations
    phase_colors = {'high': '#059669', 'low': '#dc2626', 'normal': '#6b7280'}
    for phase in phases:
        start_idx = next((i for i, d in enumerate(dates) if d >= phase['startDate']), None)
        end_idx = next((i for i, d in enumerate(dates) if d >= phase['endDate']), len(dates) - 1)
        if start_idx is not None:
            ax1.axvspan(start_idx, end_idx, alpha=0.05, color=phase_colors.get(phase['phase'], GRAY))

    # Acceleration plot
    positive = [max(0, a) for a in accels]
    negative = [min(0, a) for a in accels]
    ax2.bar(x, positive, width=1, color='#059669', alpha=0.6, label='Growth')
    ax2.bar(x, negative, width=1, color='#dc2626', alpha=0.6, label='Decline')
    ax2.axhline(0, color=GRAY, linewidth=0.5)
    ax2.set_ylabel('Acceleration')
    ax2.set_xlabel('Date')
    ax2.legend(loc='upper right', fontsize=8)

    step = max(1, len(dates) // 12)
    ax2.set_xticks(x[::step])
    ax2.set_xticklabels([dates[i] for i in range(0, len(dates), step)], rotation=45, ha='right', fontsize=7)

    plt.tight_layout()
    output_png(fig)


def chart_temporal_rhythm(data):
    clusters = data.get('rhythmClusters', [])
    if not clusters:
        return empty_chart('No rhythm data')

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    # Left: Average hourly distribution
    all_dists = [c['distribution'] for c in clusters]
    avg_dist = np.mean(all_dists, axis=0) if all_dists else np.zeros(24)

    ax = axes[0]
    hours = np.arange(24)
    bars = ax.bar(hours, avg_dist, color=NAVY, alpha=0.7, edgecolor='white', width=0.8)
    # Highlight peak hours
    peak = np.argmax(avg_dist)
    bars[peak].set_color('#d97706')
    bars[peak].set_alpha(1.0)

    ax.set_xticks(range(0, 24, 2))
    ax.set_xlabel('Hour of Day')
    ax.set_ylabel('Proportion of Activity')
    ax.set_title('Community Activity by Hour', fontweight='bold')
    ax.grid(axis='y', alpha=0.3)

    # Right: Cluster distribution
    ax = axes[1]
    type_labels = {'morning': 'Morning\n(6-12)', 'afternoon': 'Afternoon\n(12-18)', 'evening': 'Evening\n(18-24)', 'night': 'Night\n(0-6)'}
    type_colors = {'morning': '#f59e0b', 'afternoon': '#059669', 'evening': '#7c3aed', 'night': '#1e3a5f'}
    type_counts = {}
    for c in clusters:
        t = c['type']
        type_counts[t] = type_counts.get(t, 0) + 1

    labels = []
    sizes = []
    colors_pie = []
    for t in ['morning', 'afternoon', 'evening', 'night']:
        if type_counts.get(t, 0) > 0:
            labels.append(type_labels[t])
            sizes.append(type_counts[t])
            colors_pie.append(type_colors[t])

    if sizes:
        wedges, texts, autotexts = ax.pie(sizes, labels=labels, colors=colors_pie, autopct='%1.0f%%',
                                           startangle=90, textprops={'fontsize': 9})
        for t in autotexts:
            t.set_fontsize(9)
            t.set_fontweight('bold')
    ax.set_title('Learner Chronotype Distribution', fontweight='bold')

    plt.tight_layout()
    output_png(fig)


def chart_discourse_levels(data):
    kb = data.get('kbDiscourse', {})
    level_dist = kb.get('levelDistribution', {})
    progression = kb.get('progression', [])
    if not level_dist:
        return empty_chart('No discourse level data')

    fig, axes = plt.subplots(1, 2, figsize=(11, 5), gridspec_kw={'width_ratios': [1.5, 1]})

    # Left: Stacked bar with level descriptions
    ax = axes[0]
    levels = [1, 2, 3, 4]
    counts = [level_dist.get(str(l), level_dist.get(l, 0)) for l in levels]
    total = sum(counts) or 1
    pcts = [c / total * 100 for c in counts]

    level_labels = ['L1: Simple Assertion', 'L2: Supported Explanation', 'L3: Synthesis', 'L4: Rise-above']
    level_colors = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981']

    bars = ax.barh(range(4), pcts, color=level_colors, alpha=0.8, edgecolor='white', height=0.6)
    ax.set_yticks(range(4))
    ax.set_yticklabels(level_labels, fontsize=9)
    ax.set_xlabel('Percentage of Notes (%)')
    ax.set_title('Knowledge Building Discourse Levels\n(van Aalst, 2009)', fontweight='bold')

    for i, (bar, count, pct) in enumerate(zip(bars, counts, pcts)):
        if pct > 3:
            ax.text(bar.get_width() + 0.5, i, f'{count} ({pct:.0f}%)', va='center', fontsize=8, color=GRAY)

    ax.set_xlim(0, max(pcts) * 1.3)
    ax.grid(axis='x', alpha=0.3)

    # Right: Progression over time
    ax = axes[1]
    if len(progression) == 3:
        x = [1, 2, 3]
        ax.plot(x, progression, 'o-', color=NAVY, linewidth=2, markersize=10)
        ax.fill_between(x, 1, progression, alpha=0.1, color=NAVY)
        ax.set_xticks(x)
        ax.set_xticklabels(['Early', 'Middle', 'Late'])
        ax.set_ylim(0.8, 4.2)
        ax.set_ylabel('Average Discourse Level')
        ax.set_title('Discourse Quality Progression', fontweight='bold')
        ax.axhline(2, color=GRAY, linestyle=':', linewidth=0.8, alpha=0.5)
        ax.grid(axis='y', alpha=0.3)

        # Trend arrow
        if progression[-1] > progression[0]:
            ax.annotate('↗ Improving', xy=(2.5, max(progression) + 0.1), fontsize=9, color='#059669', fontweight='bold')
        elif progression[-1] < progression[0]:
            ax.annotate('↘ Declining', xy=(2.5, max(progression) + 0.1), fontsize=9, color='#dc2626', fontweight='bold')

    plt.tight_layout()
    output_png(fig)


def chart_discourse_progression(data):
    ccr = data.get('collectiveCognitiveResponsibility', {})
    productive = data.get('productiveDiscourse', {})
    if not ccr:
        return empty_chart('No CCR data')

    fig, axes = plt.subplots(1, 2, figsize=(11, 5))

    # Left: CCR contributions
    ax = axes[0]
    contributions = ccr.get('authorContributions', [])
    if contributions:
        contributions = sorted(contributions, key=lambda c: c.get('improvedOthers', 0), reverse=True)[:20]
        labels = [c['authorId'][:6] for c in contributions]
        improved_others = [c.get('improvedOthers', 0) for c in contributions]
        improved_by = [c.get('improvedByOthers', 0) for c in contributions]

        y = np.arange(len(labels))
        height = 0.35
        ax.barh(y - height/2, improved_others, height, label='Improved others', color=NAVY, alpha=0.7)
        ax.barh(y + height/2, improved_by, height, label='Improved by others', color='#d97706', alpha=0.7)
        ax.set_yticks(y)
        ax.set_yticklabels(labels, fontsize=7, family='monospace')
        ax.set_xlabel('Count')
        ax.set_title(f"Collective Cognitive Responsibility\nCCR Index = {ccr.get('ccrIndex', 0):.3f}", fontweight='bold')
        ax.legend(fontsize=8)
        ax.grid(axis='x', alpha=0.3)

    # Right: Productive discourse gauges
    ax = axes[1]
    q_rate = productive.get('questionResolutionRate', 0) * 100
    c_rate = productive.get('challengeResolutionRate', 0) * 100

    categories = ['Question\nResolution', 'Challenge\nResolution']
    values = [q_rate, c_rate]
    colors_bar = [NAVY, '#d97706']

    bars = ax.bar(categories, values, color=colors_bar, alpha=0.8, edgecolor='white', width=0.5)
    ax.set_ylim(0, 105)
    ax.set_ylabel('Resolution Rate (%)')
    ax.set_title('Productive Discourse\nResolution Rates', fontweight='bold')
    ax.axhline(50, color=GRAY, linestyle='--', linewidth=0.8, alpha=0.5)
    ax.text(1.5, 52, '50% threshold', fontsize=7, color=GRAY)

    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, f'{val:.0f}%',
                ha='center', fontsize=10, fontweight='bold', color=GRAY)

    ax.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    output_png(fig)


def chart_discourse_keywords(data):
    diversity = data.get('ideaDiversity', {})
    keywords = diversity.get('topKeywords', [])
    if not keywords:
        return empty_chart('No keyword data')

    fig, ax = plt.subplots(1, 1, figsize=(10, 6))

    keywords = keywords[:20]
    words = [k['word'] for k in keywords]
    scores = [k['score'] for k in keywords]
    max_score = max(scores) if scores else 1

    y = np.arange(len(words))
    colors_list = [plt.cm.Blues(0.3 + 0.7 * s / max_score) for s in scores]

    bars = ax.barh(y, scores, color=colors_list, edgecolor='white', height=0.7)
    ax.set_yticks(y)
    ax.set_yticklabels(words, fontsize=9)
    ax.set_xlabel('TF-IDF Score')
    ax.set_title(f'Top Keywords (Vocabulary Entropy = {diversity.get("vocabularyEntropy", 0):.2f})',
                 fontsize=12, fontweight='bold')
    ax.invert_yaxis()
    ax.grid(axis='x', alpha=0.3)

    plt.tight_layout()
    output_png(fig)


def chart_equity_lorenz(data):
    lorenz = data.get('lorenz', [])
    gini = data.get('gini', 0)
    if not lorenz:
        return empty_chart('No Lorenz data')

    fig, ax = plt.subplots(1, 1, figsize=(7, 7))

    pop_pct = [0] + [p['populationPct'] for p in lorenz]
    contrib_pct = [0] + [p['contributionPct'] for p in lorenz]

    # Equality line
    ax.plot([0, 100], [0, 100], 'k--', linewidth=1, alpha=0.4, label='Perfect equality')

    # Lorenz curve
    ax.plot(pop_pct, contrib_pct, color=NAVY, linewidth=2.5, label=f'Lorenz curve (Gini = {gini:.4f})')
    ax.fill_between(pop_pct, contrib_pct, [p for p in pop_pct], alpha=0.12, color=NAVY)

    # Gini annotation
    ax.annotate(f'Gini = {gini:.4f}', xy=(60, 30), fontsize=14, fontweight='bold', color=NAVY)

    # Interpretation
    if gini < 0.25:
        interp = 'Relatively equitable'
        interp_color = '#059669'
    elif gini < 0.4:
        interp = 'Moderate inequality'
        interp_color = '#d97706'
    else:
        interp = 'High inequality'
        interp_color = '#dc2626'
    ax.text(60, 22, interp, fontsize=10, color=interp_color)

    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.set_xlabel('Cumulative % of Participants (ranked by contribution)')
    ax.set_ylabel('Cumulative % of Total Contributions')
    ax.set_title('Lorenz Curve — Participation Equity', fontsize=13, fontweight='bold')
    ax.legend(loc='upper left', fontsize=9)
    ax.grid(alpha=0.2)
    ax.set_aspect('equal')

    plt.tight_layout()
    output_png(fig)


def chart_equity_temporal(data):
    temporal = data.get('temporalEquity', [])
    if not temporal:
        return empty_chart('No temporal equity data')

    fig, ax = plt.subplots(1, 1, figsize=(10, 5))

    dates = [t['windowStart'] for t in temporal]
    ginis = [t['gini'] for t in temporal]
    active_counts = [t['activeCount'] for t in temporal]
    x = np.arange(len(dates))

    # Gini line
    ax.plot(x, ginis, 'o-', color=NAVY, linewidth=2, markersize=4, label='Gini coefficient')
    ax.fill_between(x, 0, ginis, alpha=0.08, color=NAVY)

    # Threshold lines
    ax.axhline(0.25, color='#059669', linestyle='--', linewidth=1, alpha=0.6, label='Equitable (< 0.25)')
    ax.axhline(0.4, color='#dc2626', linestyle='--', linewidth=1, alpha=0.6, label='Unequal (> 0.4)')

    # Active count on secondary axis
    ax2 = ax.twinx()
    ax2.bar(x, active_counts, alpha=0.15, color=GRAY, width=0.8, label='Active participants')
    ax2.set_ylabel('Active Participants', color=GRAY)
    ax2.tick_params(axis='y', labelcolor=GRAY)

    step = max(1, len(dates) // 10)
    ax.set_xticks(x[::step])
    ax.set_xticklabels([dates[i] for i in range(0, len(dates), step)], rotation=45, ha='right', fontsize=7)

    ax.set_xlabel('Time Window')
    ax.set_ylabel('Gini Coefficient')
    ax.set_title('Participation Equity Over Time', fontsize=13, fontweight='bold')
    ax.legend(loc='upper left', fontsize=8)
    ax.set_ylim(0, min(max(ginis) * 1.5, 1.0))
    ax.grid(axis='y', alpha=0.2)

    # Trend annotation
    if len(ginis) >= 2:
        slope = (ginis[-1] - ginis[0]) / len(ginis)
        trend = '↗ Worsening' if slope > 0.005 else '↘ Improving' if slope < -0.005 else '→ Stable'
        trend_color = '#dc2626' if slope > 0.005 else '#059669' if slope < -0.005 else GRAY
        ax.text(0.98, 0.95, trend, transform=ax.transAxes, fontsize=11, fontweight='bold',
                color=trend_color, ha='right', va='top')

    plt.tight_layout()
    output_png(fig)


def chart_equity_palma(data):
    palma = data.get('palmaRatio', 1)
    voice = data.get('voiceEquity', 0)
    quality_gini = data.get('qualityWeightedGini', 0)
    interaction_div = data.get('interactionDiversity', [])

    fig, axes = plt.subplots(1, 3, figsize=(12, 4.5))

    # Palma ratio gauge
    ax = axes[0]
    theta = np.linspace(0, np.pi, 100)
    ax.plot(np.cos(theta), np.sin(theta), color=GRAY, linewidth=2)
    # Palma needle
    palma_capped = min(palma, 5) if palma != float('inf') else 5
    angle = np.pi * (1 - palma_capped / 5)
    ax.plot([0, 0.7 * np.cos(angle)], [0, 0.7 * np.sin(angle)], color=NAVY, linewidth=3)
    ax.scatter([0], [0], color=NAVY, s=50, zorder=5)
    # Scale markers
    for v, label in [(1, '1.0'), (2, '2.0'), (3, '3.0'), (4, '4.0')]:
        a = np.pi * (1 - v / 5)
        ax.text(0.85 * np.cos(a), 0.85 * np.sin(a), label, ha='center', fontsize=7, color=GRAY)
    # Zones
    ax.fill_between(np.cos(np.linspace(np.pi, np.pi*0.7, 50)), 0, np.sin(np.linspace(np.pi, np.pi*0.7, 50)), alpha=0.1, color='#059669')
    ax.fill_between(np.cos(np.linspace(np.pi*0.7, np.pi*0.4, 50)), 0, np.sin(np.linspace(np.pi*0.7, np.pi*0.4, 50)), alpha=0.1, color='#f59e0b')
    ax.fill_between(np.cos(np.linspace(np.pi*0.4, 0, 50)), 0, np.sin(np.linspace(np.pi*0.4, 0, 50)), alpha=0.1, color='#dc2626')

    ax.set_xlim(-1.1, 1.1)
    ax.set_ylim(-0.2, 1.1)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title(f'Palma Ratio = {palma:.2f}' if palma != float('inf') else 'Palma Ratio = ∞', fontweight='bold')
    ax.text(0, -0.15, 'Top 10% / Bottom 40%', ha='center', fontsize=8, color=GRAY)

    # Voice equity
    ax = axes[1]
    voice_pct = voice * 100
    ax.pie([voice_pct, 100 - voice_pct], colors=[NAVY, '#e5e7eb'],
           startangle=90, counterclock=False,
           wedgeprops={'width': 0.3, 'edgecolor': 'white'})
    ax.text(0, 0, f'{voice_pct:.0f}%', ha='center', va='center', fontsize=18, fontweight='bold', color=NAVY)
    ax.set_title('Voice Equity\n(% who received responses)', fontweight='bold')

    # Quality-weighted Gini comparison
    ax = axes[2]
    categories = ['Quantity\nGini', 'Quality-\nWeighted Gini']
    values = [data.get('gini', quality_gini), quality_gini]
    bars = ax.bar(categories, values, color=[NAVY, '#7c3aed'], alpha=0.8, width=0.5, edgecolor='white')
    ax.axhline(0.25, color='#059669', linestyle='--', linewidth=0.8)
    ax.axhline(0.4, color='#dc2626', linestyle='--', linewidth=0.8)
    ax.set_ylim(0, max(max(values) * 1.3, 0.5))
    ax.set_ylabel('Gini Coefficient')
    ax.set_title('Quantity vs Quality\nInequality', fontweight='bold')
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01, f'{val:.3f}',
                ha='center', fontsize=9, fontweight='bold', color=GRAY)
    ax.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    output_png(fig)


def empty_chart(message):
    fig, ax = plt.subplots(1, 1, figsize=(8, 4))
    ax.text(0.5, 0.5, message, ha='center', va='center', fontsize=14, color=GRAY)
    ax.axis('off')
    output_png(fig)


CHART_HANDLERS = {
    'sna_network': chart_sna_network,
    'sna_centrality': chart_sna_centrality,
    'lsa_heatmap': chart_lsa_heatmap,
    'lsa_transitions': chart_lsa_transitions,
    'temporal_timeline': chart_temporal_timeline,
    'temporal_momentum': chart_temporal_momentum,
    'temporal_rhythm': chart_temporal_rhythm,
    'discourse_levels': chart_discourse_levels,
    'discourse_progression': chart_discourse_progression,
    'discourse_keywords': chart_discourse_keywords,
    'equity_lorenz': chart_equity_lorenz,
    'equity_temporal': chart_equity_temporal,
    'equity_palma': chart_equity_palma,
}


def main():
    input_data = json.loads(sys.stdin.read())
    chart_type = input_data.get('chart_type', '')
    data = input_data.get('data', {})

    handler = CHART_HANDLERS.get(chart_type)
    if not handler:
        empty_chart(f'Unknown chart type: {chart_type}')
        return

    try:
        handler(data)
    except Exception as e:
        empty_chart(f'Error: {str(e)[:100]}')


if __name__ == '__main__':
    main()
