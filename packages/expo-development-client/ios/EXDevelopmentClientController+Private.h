#import "EXDevelopmentClientController.h"

@class EXDevelopmentClientRecentlyOpenedAppsRegistry;

@interface EXDevelopmentClientController ()

@property (nonatomic, weak) UIWindow *window;
@property (nonatomic, weak) id<EXDevelopmentClientControllerDelegate> delegate;
@property (nonatomic, strong) NSDictionary *launchOptions;
@property (nonatomic, strong) NSURL *sourceUrl;
@property (nonatomic, strong) RCTBridge *launcherBridge;
@property (nonatomic, strong) EXDevelopmentClientRecentlyOpenedAppsRegistry *recentlyOpenedAppsRegistry;

@end
