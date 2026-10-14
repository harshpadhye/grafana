import { waitFor } from '@testing-library/react';

import { getDefaultTimeRange, LoadingState, PanelPlugin } from '@grafana/data';
import { PanelStatusStore } from '@grafana/data/internal';
import { setPluginImportUtils } from '@grafana/runtime';
import { SceneDataNode, VizPanel } from '@grafana/scenes';
import { InspectTab } from 'app/features/inspector/types';

import { DashboardScene } from '../scene/DashboardScene';
import { DefaultGridLayoutManager } from '../scene/layout-default/DefaultGridLayoutManager';

import { PanelInspectDrawer } from './PanelInspectDrawer';

const plugin = new PanelPlugin(() => null);
setPluginImportUtils({ getPanelPluginFromCache: () => plugin, importPanelPlugin: async () => plugin });

function setup() {
  const store = new PanelStatusStore();
  const data = new SceneDataNode({ data: { series: [], state: LoadingState.Done, timeRange: getDefaultTimeRange() } });
  const panel = new VizPanel({
    $data: data,
    extendPanelContext: (_, context) => {
      context.notices = store;
    },
  });
  const drawer = new PanelInspectDrawer({ panelRef: panel.getRef(), currentTab: InspectTab.ErrorsAndNotices });
  new DashboardScene({ body: DefaultGridLayoutManager.fromVizPanels([panel]), overlay: drawer });
  return { store, data, panel, drawer, tabs: () => drawer.state.tabs?.map((tab) => tab.getTabValue()) };
}

it('shows only JSON for an empty panel and reacts to notices appearing and clearing', async () => {
  const { store, drawer, tabs } = setup();
  const deactivate = drawer.activate();
  await waitFor(() => expect(tabs()).toEqual([InspectTab.JSON]));
  const source = store.createSource();
  source.set([{ id: 'panel', severity: 'warning', text: 'Choose field' }]);
  await waitFor(() => expect(tabs()).toEqual([InspectTab.ErrorsAndNotices, InspectTab.JSON]));
  const noticeTab = drawer.state.tabs![0];
  source.set([{ id: 'panel', severity: 'warning', text: 'Updated notice' }]);
  await waitFor(() => expect(drawer.state.tabs![0]).toBe(noticeTab));
  source.set([]);
  await waitFor(() => expect(tabs()).toEqual([InspectTab.JSON]));
  deactivate();
  source.set([{ id: 'late', severity: 'info', text: 'Late notice' }]);
  expect(tabs()).toEqual([InspectTab.JSON]);
});

it('uses query and plugin-load fallback but respects an initialized empty snapshot', async () => {
  const { store, drawer, tabs, data, panel } = setup();
  data.setState({ data: { ...data.state.data!, errors: [{ message: 'Query failed' }] } });
  await drawer.buildTabs(0);
  expect(tabs()).toEqual([InspectTab.ErrorsAndNotices, InspectTab.JSON]);
  store.setExternal([]);
  await drawer.buildTabs(0);
  expect(tabs()).toEqual([InspectTab.JSON]);
  store.clear();
  data.setState({ data: { ...data.state.data!, errors: [] } });
  panel.setState({ _pluginLoadError: 'Plugin failed' });
  await drawer.buildTabs(0);
  expect(tabs()).toEqual([InspectTab.ErrorsAndNotices, InspectTab.JSON]);
});
