import { getPanelDataStatusItems } from '@grafana/data/internal';
import { Trans, t } from '@grafana/i18n';
import {
  type SceneComponentProps,
  SceneObjectBase,
  type SceneObjectState,
  sceneGraph,
  type VizPanel,
  type SceneObjectRef,
} from '@grafana/scenes';
import { Alert, Drawer, Tab, TabsBar } from '@grafana/ui';
import {
  getDataSourceWithInspector,
  getDataSourceWithErrorsAndNoticesInspector,
} from 'app/features/dashboard/components/Inspector/hooks';
import { supportsDataQuery } from 'app/features/dashboard/components/PanelEditor/utils';
import { InspectTab } from 'app/features/inspector/types';

import { getDashboardSceneFor } from '../utils/utils';

import { HelpWizard } from './HelpWizard/HelpWizard';
import { InspectDataTab } from './InspectDataTab';
import { InspectErrorsAndNoticesTab } from './InspectErrorsAndNoticesTab';
import { InspectJsonTab } from './InspectJsonTab';
import { InspectMetaDataTab } from './InspectMetaDataTab';
import { InspectQueryTab } from './InspectQueryTab';
import { InspectStatsTab } from './InspectStatsTab';
import { type SceneInspectTab } from './types';

interface PanelInspectDrawerState extends SceneObjectState {
  tabs?: SceneInspectTab[];
  currentTab: InspectTab;
  panelRef: SceneObjectRef<VizPanel>;
  pluginNotLoaded?: boolean;
  canEdit?: boolean;
}

export class PanelInspectDrawer extends SceneObjectBase<PanelInspectDrawerState> {
  static Component = PanelInspectRenderer;
  private buildVersion = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(state: PanelInspectDrawerState) {
    super(state);
    this.addActivationHandler(() => this._activationHandler());
  }

  private _activationHandler() {
    const panel = this.state.panelRef.resolve();
    const context = panel.getPanelContext();
    const deactivate = context.activateNotices?.();
    const update = () => {
      void this.buildTabs(0);
    };
    let provider = sceneGraph.getData(panel);
    let dataSubscription = provider.subscribeToState(update);
    const unsubscribe = context.notices?.subscribe(update);
    const panelSubscription = panel.subscribeToState((state, previous) => {
      if (state.$data !== previous.$data) {
        dataSubscription.unsubscribe();
        provider = sceneGraph.getData(panel);
        dataSubscription = provider.subscribeToState(update);
      }
      if (
        state.$data !== previous.$data ||
        state._pluginLoadError !== previous._pluginLoadError ||
        state.pluginId !== previous.pluginId
      ) {
        update();
      }
    });
    update();
    return () => {
      this.buildVersion++;
      clearTimeout(this.retryTimer);
      unsubscribe?.();
      dataSubscription.unsubscribe();
      panelSubscription.unsubscribe();
      deactivate?.();
    };
  }

  /**
   * We currently have no async await to get the panel plugin from the VizPanel.
   * That is why there is a retry argument here and a setTimeout, to try again a bit later.
   */
  async buildTabs(retry: number) {
    const version = ++this.buildVersion;
    clearTimeout(this.retryTimer);
    const panelRef = this.state.panelRef;
    const plugin = panelRef.resolve()?.getPlugin();
    const tabs: SceneInspectTab[] = [];

    if (!plugin) {
      if (retry < 2000) {
        this.retryTimer = setTimeout(() => this.buildTabs(retry + 100), 100);
      } else {
        this.setState({ pluginNotLoaded: true });
      }
    }

    if (panelRef) {
      if (supportsDataQuery(plugin)) {
        const data = sceneGraph.getData(panelRef.resolve());

        tabs.push(new InspectDataTab({ panelRef }));
        tabs.push(new InspectStatsTab({ panelRef }));
        tabs.push(new InspectQueryTab({ panelRef }));

        const dsWithInspector = await getDataSourceWithInspector(data.state.data);
        if (dsWithInspector) {
          tabs.push(new InspectMetaDataTab({ panelRef, dataSource: dsWithInspector }));
        }
      }

      const panel = panelRef.resolve();
      const panelData = sceneGraph.getData(panel).state.data;
      const snapshot = panel.getPanelContext().notices?.getSnapshot();
      const statusItems = snapshot?.hostInitialized
        ? snapshot.items
        : [...getPanelDataStatusItems(panelData, panel.state._pluginLoadError), ...(snapshot?.items ?? [])];
      if (statusItems.length > 0) {
        const dataSource = await getDataSourceWithErrorsAndNoticesInspector(panelData);
        tabs.push(new InspectErrorsAndNoticesTab({ panelRef, dataSource, onClose: this.onClose }));
      }

      tabs.push(
        this.state.tabs?.find((tab) => tab instanceof InspectJsonTab) ??
          new InspectJsonTab({ panelRef, onClose: this.onClose })
      );
    }

    if (version === this.buildVersion) {
      // Notice/action updates must not remount tabs and discard inspector UI state.
      const stableTabs = tabs.map((tab) => {
        const previous = this.state.tabs?.find((candidate) => candidate.getTabValue() === tab.getTabValue());
        if (previous instanceof InspectErrorsAndNoticesTab && tab instanceof InspectErrorsAndNoticesTab) {
          return previous.state.dataSource === tab.state.dataSource ? previous : tab;
        }
        if (previous instanceof InspectMetaDataTab && tab instanceof InspectMetaDataTab) {
          return previous.state.dataSource === tab.state.dataSource ? previous : tab;
        }
        return previous ?? tab;
      });
      this.setState({ tabs: stableTabs });
    }
  }

  getDrawerTitle() {
    const panel = this.state.panelRef?.resolve();
    if (panel) {
      return sceneGraph.interpolate(panel, `Inspect: ${panel.state.title}`);
    }
    return `Inspect panel`;
  }

  onClose = () => {
    getDashboardSceneFor(this).closeModal();
  };
}

function PanelInspectRenderer({ model }: SceneComponentProps<PanelInspectDrawer>) {
  const { tabs, pluginNotLoaded, panelRef, currentTab } = model.useState();

  if (!tabs) {
    return null;
  }

  const vizPanel = panelRef!.resolve();
  const activeTab = tabs.find((tab) => tab.getTabValue() === currentTab) ?? tabs[0];

  if (currentTab === InspectTab.Help) {
    return <HelpWizard panel={vizPanel} onClose={model.onClose} />;
  }

  return (
    <Drawer
      title={model.getDrawerTitle()}
      onClose={model.onClose}
      size="md"
      tabs={
        <TabsBar>
          {tabs.map((tab) => {
            return (
              <Tab
                key={tab.state.key!}
                label={tab.getTabLabel()}
                active={tab === activeTab}
                onChangeTab={() => {
                  model.setState({ currentTab: tab.getTabValue() });
                }}
              />
            );
          })}
        </TabsBar>
      }
    >
      {pluginNotLoaded && (
        <Alert
          title={t('dashboard-scene.panel-inspect-renderer.title-panel-plugin-not-loaded', 'Panel plugin not loaded')}
        >
          <Trans i18nKey="dashboard-scene.panel-inspect-renderer.body-panel-plugin-not-loaded">
            Make sure the panel you want to inspect is visible and has been displayed before opening inspect.
          </Trans>
        </Alert>
      )}
      {activeTab.Component && <activeTab.Component model={activeTab} />}
    </Drawer>
  );
}
